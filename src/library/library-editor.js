import { join } from 'node:path';
import { ValidationError } from './errors.js';
import { updateJsonFile } from './options-store.js';
import { sortBy } from './sort.js';
import { isPlainObject, validateAudioOptions } from './validate.js';

/** @typedef {import('./library.js').Library} Library */
/** @typedef {import('./library.js').AudioFile} AudioFile */
/** @typedef {import('./library.js').Playlist} Playlist */
/** @typedef {import('./settings-store.js').FileUpdater} FileUpdater */
/** @typedef {{ title?: string, gain?: number }} OptionChanges */

/** The only options the app itself changes; anything else in a request is rejected. */
const EDITABLE_KEYS = ['title', 'gain'];

/** The id does not belong to a sound in the library. */
export class UnknownSoundError extends Error {
	/** @param {string} soundId */
	constructor(soundId) {
		super(`Unknown sound "${soundId}"`);
		this.name = 'UnknownSoundError';
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
		const normalized = normalizeChanges(changes);
		// Sound options files sit next to their audio file with ".json" appended (DESIGN.md §2.1).
		await this.#queueWrite(`${sound.absolutePath}.json`, (current) => ({ ...current, ...normalized }));
		Object.assign(sound, normalized);
		if (normalized.title !== undefined) {
			this.#library.sounds = sortBy(this.#library.sounds, (entry) => entry.title);
		}
		return sound;
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
		const normalized = normalizeChanges(changes);
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
 * Checks a title and gain change with the options file rules (both kinds of options file share them for these keys),
 * then trims the title and rounds the gain.
 * @param {unknown} changes
 * @returns {OptionChanges}
 */
function normalizeChanges(changes) {
	if (!isPlainObject(changes)) {
		throw new ValidationError(null, ['must be a JSON object']);
	}
	const unknown = Object.keys(changes).filter((key) => !EDITABLE_KEYS.includes(key));
	const problems = [...unknown.map((key) => `Unknown option "${key}"`), ...validateAudioOptions(changes)];
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
	return normalized;
}
