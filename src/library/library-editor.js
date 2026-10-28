import { lstat, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { safeFileName, uniqueName } from '../downloads/file-names.js';
import { audioFormatOf } from './classify.js';
import { measureIfNeeded } from './durations.js';
import { ValidationError } from './errors.js';
import { audioFileOf, playlistOf } from './library.js';
import { updateJsonFile, writeJsonAtomic } from './options-store.js';
import { sortBy } from './sort.js';
import { checkClip, isPlainObject, validateAudioOptions, validatePlaylistOptions } from './validate.js';

/** @typedef {import('./library.js').Library} Library */
/** @typedef {import('./library.js').AudioFile} AudioFile */
/** @typedef {import('./library.js').Playlist} Playlist */
/** @typedef {import('./settings-store.js').FileUpdater} FileUpdater */
/**
 * @typedef {{ title?: string, gain?: number, crossfade?: number, fadeIn?: number, fadeOut?: number, startAt?: number,
 * 	endAt?: number | null, order?: import('./validate.js').PlaybackOrder, trackLooping?: boolean,
 * 	stopMode?: import('./validate.js').StopMode }} OptionChanges
 */

/** @typedef {{ title: string, source: import('./validate.js').Source }} NewFileOptions */
/** @typedef {{ written: string[] }} Addition `written` lists every file created, for the change watcher's baseline */

/** @type {readonly ('crossfade' | 'fadeIn' | 'fadeOut')[]} */
const SECONDS_KEYS = ['crossfade', 'fadeIn', 'fadeOut'];

/** The only options the app itself changes, per kind of item; anything else in a request is rejected. */
const EDITABLE = {
	sound: { keys: ['title', 'gain', 'startAt', 'endAt', 'fadeIn', 'fadeOut'], validate: validateAudioOptions },
	playlist: { keys: ['title', 'gain', ...SECONDS_KEYS, 'order', 'trackLooping', 'stopMode'], validate: validatePlaylistOptions },
	track: { keys: ['title', 'gain', 'startAt', 'endAt'], validate: validateAudioOptions },
};

/** The id does not belong to a sound in the library. */
export class UnknownSoundError extends Error {
	/** @param {string} soundId */
	constructor(soundId) {
		super(`Unknown sound "${soundId}"`);
		this.name = 'UnknownSoundError';
	}
}

/** The id does not belong to a track of any playlist in the library. */
export class UnknownTrackError extends Error {
	/** @param {string} trackId */
	constructor(trackId) {
		super(`Unknown track "${trackId}"`);
		this.name = 'UnknownTrackError';
	}
}

/** The id does not belong to a playlist in the library. */
export class UnknownPlaylistError extends Error {
	/** @param {string} playlistId */
	constructor(playlistId) {
		super(`Unknown playlist "${playlistId}"`);
		this.name = 'UnknownPlaylistError';
	}
}

/**
 * Changes the library while the app runs, saving each change to its options file (DESIGN.md §2.3). Writes to one file
 * never overlap: they run in the order they were requested, so the file always ends with the newest values.
 */
export class LibraryEditor {
	#library;
	#updateFile;
	/** The last write queued for each options file. @type {Map<string, Promise<unknown>>} */
	#writes = new Map();

	/**
	 * @param {Library} library updated in place
	 * @param {{ updateFile?: FileUpdater }} [options]
	 */
	constructor(library, { updateFile = updateJsonFile } = {}) {
		this.#library = library;
		this.#updateFile = updateFile;
	}

	/**
	 * Validates and saves the change, then applies it to the library. The library is left unchanged if saving fails.
	 * @param {string} soundId
	 * @param {OptionChanges} changes
	 * @returns {Promise<AudioFile>}
	 */
	async updateSound(soundId, changes) {
		const sound = this.#library.sounds.find((entry) => entry.id === soundId);
		if (!sound) {
			throw new UnknownSoundError(soundId);
		}
		const normalized = normalizeChanges(changes, EDITABLE.sound);
		// A change to one point must still fit the other one already stored.
		const clipProblems = checkClip({ startAt: sound.startAt, endAt: sound.endAt, ...normalized });
		if (clipProblems.length > 0) {
			throw new ValidationError(null, clipProblems);
		}
		// Sound options files sit next to their audio file with ".json" appended (DESIGN.md §2.1).
		await this.#queueWrite(`${sound.absolutePath}.json`, (current) => ({ ...current, ...normalized }));
		Object.assign(sound, normalized);
		if (normalized.title !== undefined) {
			this.#library.sounds = sortBy(this.#library.sounds, (entry) => entry.title);
		}
		return sound;
	}

	/**
	 * Like `updateSound`, for a track; only its title, gain and start and end points can change. Tracks keep their
	 * path order (DESIGN.md §2.2), so nothing is sorted again.
	 * @param {string} trackId
	 * @param {OptionChanges} changes
	 * @returns {Promise<AudioFile>}
	 */
	async updateTrack(trackId, changes) {
		const track = this.#library.playlists.flatMap((playlist) => playlist.tracks).find((entry) => entry.id === trackId);
		if (!track) {
			throw new UnknownTrackError(trackId);
		}
		const normalized = normalizeChanges(changes, EDITABLE.track);
		const clipProblems = checkClip({ startAt: track.startAt, endAt: track.endAt, ...normalized });
		if (clipProblems.length > 0) {
			throw new ValidationError(null, clipProblems);
		}
		await this.#queueWrite(`${track.absolutePath}.json`, (current) => ({ ...current, ...normalized }));
		Object.assign(track, normalized);
		return track;
	}

	/**
	 * Like `updateSound`, for a playlist; its other options, such as `includedSubdirectories`, are left as they are.
	 * @param {string} playlistId
	 * @param {OptionChanges} changes
	 * @returns {Promise<Playlist>}
	 */
	async updatePlaylist(playlistId, changes) {
		const playlist = this.#library.playlists.find((entry) => entry.id === playlistId);
		if (!playlist) {
			throw new UnknownPlaylistError(playlistId);
		}
		const normalized = normalizeChanges(changes, EDITABLE.playlist);
		// A playlist's options file is "<directory>.json" in the root (DESIGN.md §2.1).
		await this.#queueWrite(join(this.#library.root, `${playlist.id}.json`), (current) => ({ ...current, ...normalized }));
		Object.assign(playlist, normalized);
		if (normalized.title !== undefined) {
			this.#library.playlists = sortBy(this.#library.playlists, (entry) => entry.title);
		}
		return playlist;
	}

	/**
	 * Moves a finished download into the root as a new sound and writes its options file.
	 * @param {string} from the file, on the same file system as the root
	 * @param {string} name what to call it; ` (2)` and so on is added when the name is taken
	 * @param {NewFileOptions} options
	 * @returns {Promise<Addition & { sound: AudioFile }>}
	 */
	async addSound(from, name, options) {
		const { file, written } = await this.#place(from, '', name, options);
		this.#library.sounds = sortBy([...this.#library.sounds, file], (entry) => entry.title);
		this.#library.files.set(file.id, file);
		return { sound: file, written };
	}

	/**
	 * Moves a finished download into a playlist's directory as a new track. Tracks sort by path (DESIGN.md §2.2), so it
	 * takes its place by name.
	 * @param {string} playlistId
	 * @param {string} from
	 * @param {string} name
	 * @param {NewFileOptions} options
	 * @returns {Promise<Addition & { playlist: Playlist, track: AudioFile }>}
	 */
	async addTrack(playlistId, from, name, options) {
		const playlist = this.#library.playlists.find((entry) => entry.id === playlistId);
		if (!playlist) {
			throw new UnknownPlaylistError(playlistId);
		}
		const { file, written } = await this.#place(from, playlist.id, name, options);
		playlist.tracks = sortBy([...playlist.tracks, file], (track) => track.id);
		this.#library.files.set(file.id, file);
		return { playlist, track: file, written };
	}

	/**
	 * Creates a playlist together with its first track, so an empty playlist never exists. Its directory is named after
	 * the title.
	 * @param {string} title
	 * @param {string} from the first track
	 * @param {string} name
	 * @param {NewFileOptions} options
	 * @returns {Promise<Addition & { playlist: Playlist, track: AudioFile }>}
	 */
	async createPlaylist(title, from, name, options) {
		const trimmed = title.trim();
		if (trimmed === '') {
			throw new ValidationError(null, ['"title" must be a non-empty string']);
		}
		const root = this.#library.root;
		// "<directory>.json" next to it would become its options file, so that name counts as taken too.
		const id = await uniqueName(safeFileName(trimmed, 'Playlist'), async (candidate) => (
			await exists(join(root, candidate)) || exists(join(root, `${candidate}.json`))
		));
		await mkdir(join(root, id));
		const optionsPath = join(root, `${id}.json`);
		/** @type {import('./validate.js').PlaylistOptions} */
		const playlistOptions = { title: trimmed, includedSubdirectories: [] };
		await writeJsonAtomic(optionsPath, playlistOptions);
		const { file, written } = await this.#place(from, id, name, options);
		const playlist = playlistOf(id, playlistOptions, [file]);
		this.#library.playlists = sortBy([...this.#library.playlists, playlist], (entry) => entry.title);
		this.#library.files.set(file.id, file);
		return { playlist, track: file, written: [optionsPath, ...written] };
	}

	/**
	 * Moves a file into place under a free name, measures it, and writes its options file.
	 * @param {string} from
	 * @param {string} directoryId '' for the root, otherwise a playlist id
	 * @param {string} name
	 * @param {NewFileOptions} options
	 * @returns {Promise<{ file: AudioFile, written: string[] }>}
	 */
	async #place(from, directoryId, name, { title, source }) {
		const format = audioFormatOf(name);
		if (format === null) {
			throw new Error(`Not a supported audio file: ${name}`);
		}
		const directory = directoryId === '' ? this.#library.root : join(this.#library.root, directoryId);
		// The options file must be free as well, or an old one would be taken over.
		const finalName = await uniqueName(name, async (candidate) => (
			await exists(join(directory, candidate)) || exists(join(directory, `${candidate}.json`))
		));
		const absolutePath = join(directory, finalName);
		await rename(from, absolutePath);
		const { size, mtime } = await stat(absolutePath);
		const id = directoryId === '' ? finalName : `${directoryId}/${finalName}`;
		const scanned = { id, name: finalName, format, size, modified: mtime.toISOString(), absolutePath, optionsPath: `${absolutePath}.json`, hasOptions: false };
		/** @type {import('./validate.js').AudioOptions} */
		const fileOptions = { title: title.trim() || finalName, source, ...(await measureIfNeeded(scanned, undefined)) };
		await writeJsonAtomic(scanned.optionsPath, fileOptions);
		return { file: audioFileOf(scanned, fileOptions), written: [absolutePath, scanned.optionsPath] };
	}

	/**
	 * @param {string} path
	 * @param {import('./options-store.js').JsonUpdate} update
	 */
	#queueWrite(path, update) {
		const write = (this.#writes.get(path) ?? Promise.resolve())
			.catch(() => {})
			.then(() => this.#updateFile(path, update));
		this.#writes.set(path, write);
		const forget = () => {
			if (this.#writes.get(path) === write) {
				this.#writes.delete(path);
			}
		};
		write.then(forget, forget);
		return write;
	}
}

/** @param {string} path */
async function exists(path) {
	return lstat(path).then(() => true, () => false);
}

/**
 * Checks a change with the rules of that kind of options file, then trims the title and rounds the numbers.
 * @param {unknown} changes
 * @param {{ keys: string[], validate: (value: unknown) => string[] }} editable
 * @returns {OptionChanges}
 */
function normalizeChanges(changes, { keys, validate }) {
	if (!isPlainObject(changes)) {
		throw new ValidationError(null, ['must be a JSON object']);
	}
	const unknown = Object.keys(changes).filter((key) => !keys.includes(key));
	const problems = [...unknown.map((key) => `Unknown option "${key}"`), ...validate(changes)];
	if (problems.length > 0) {
		throw new ValidationError(null, problems);
	}
	/** @type {OptionChanges} */
	const normalized = {};
	if (typeof changes.title === 'string') {
		normalized.title = changes.title.trim();
	}
	if (typeof changes.gain === 'number') {
		normalized.gain = Math.round(changes.gain * 10_000) / 10_000;
	}
	// Every time keeps whole milliseconds, which is what the dialogs show.
	for (const key of SECONDS_KEYS) {
		const seconds = changes[key];
		if (typeof seconds === 'number') {
			normalized[key] = Math.round(seconds * 1000) / 1000;
		}
	}
	if (typeof changes.order === 'string') {
		normalized.order = /** @type {import('./validate.js').PlaybackOrder} */ (changes.order);
	}
	if (typeof changes.trackLooping === 'boolean') {
		normalized.trackLooping = changes.trackLooping;
	}
	if (typeof changes.stopMode === 'string') {
		normalized.stopMode = /** @type {import('./validate.js').StopMode} */ (changes.stopMode);
	}
	if (typeof changes.startAt === 'number') {
		normalized.startAt = Math.round(changes.startAt * 1000) / 1000;
	}
	if (typeof changes.endAt === 'number' || changes.endAt === null) {
		normalized.endAt = changes.endAt === null ? null : Math.round(changes.endAt * 1000) / 1000;
	}
	return normalized;
}
