import { join } from 'node:path';
import { ValidationError } from './errors.js';
import { updateJsonFile } from './options-store.js';
import { sortBy } from './sort.js';
import { checkClip, isPlainObject, validateAudioOptions, validatePlaylistOptions } from './validate.js';

/** @typedef {import('./library.js').Library} Library */
/** @typedef {import('./library.js').AudioFile} AudioFile */
/** @typedef {import('./library.js').Playlist} Playlist */
/** @typedef {import('./settings-store.js').FileUpdater} FileUpdater */
/**
 * @typedef {{ title?: string, gain?: number, crossfade?: number, fadeIn?: number, fadeOut?: number, startAt?: number,
 * 	endAt?: number | null, order?: import('./validate.js').PlaybackOrder }} OptionChanges
 */

/** @type {readonly ('crossfade' | 'fadeIn' | 'fadeOut')[]} */
const SECONDS_KEYS = ['crossfade', 'fadeIn', 'fadeOut'];

/** The only options the app itself changes, per kind of item; anything else in a request is rejected. */
const EDITABLE = {
	sound: { keys: ['title', 'gain', 'startAt', 'endAt', 'fadeIn', 'fadeOut'], validate: validateAudioOptions },
	playlist: { keys: ['title', 'gain', ...SECONDS_KEYS, 'order'], validate: validatePlaylistOptions },
	track: { keys: ['title'], validate: validateAudioOptions },
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
	 * Like `updateSound`, for a track; only its title can change for now. Tracks keep their path order (DESIGN.md §2.2),
	 * so nothing is sorted again.
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
	if (typeof changes.startAt === 'number') {
		normalized.startAt = Math.round(changes.startAt * 1000) / 1000;
	}
	if (typeof changes.endAt === 'number' || changes.endAt === null) {
		normalized.endAt = changes.endAt === null ? null : Math.round(changes.endAt * 1000) / 1000;
	}
	return normalized;
}
