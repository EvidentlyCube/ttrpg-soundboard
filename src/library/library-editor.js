import { ValidationError } from './errors.js';
import { updateJsonFile } from './options-store.js';
import { sortBy } from './sort.js';
import { isPlainObject, validateAudioOptions } from './validate.js';

/** @typedef {import('./library.js').Library} Library */
/** @typedef {import('./library.js').AudioFile} AudioFile */
/** @typedef {import('./settings-store.js').FileUpdater} FileUpdater */
/** @typedef {{ title?: string, gain?: number }} SoundChanges */

const SOUND_OPTION_KEYS = ['title', 'gain'];

/** The id does not belong to a sound in the library. */
export class UnknownSoundError extends Error {
	/** @param {string} soundId */
	constructor(soundId) {
		super(`Unknown sound "${soundId}"`);
		this.name = 'UnknownSoundError';
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
	 * @param {SoundChanges} changes
	 * @returns {Promise<AudioFile>}
	 */
	async updateSound(soundId, changes) {
		const sound = this.#library.sounds.find((entry) => entry.id === soundId);
		if (!sound) {
			throw new UnknownSoundError(soundId);
		}
		const normalized = normalizeSoundChanges(changes);
		// Sound options files sit next to their audio file with ".json" appended (DESIGN.md §2.1).
		await this.#queueWrite(`${sound.absolutePath}.json`, (current) => ({ ...current, ...normalized }));
		Object.assign(sound, normalized);
		if (normalized.title !== undefined) {
			this.#library.sounds = sortBy(this.#library.sounds, (entry) => entry.title);
		}
		return sound;
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
 * @param {unknown} changes
 * @returns {SoundChanges}
 */
function normalizeSoundChanges(changes) {
	if (!isPlainObject(changes)) {
		throw new ValidationError(null, ['must be a JSON object']);
	}
	const unknown = Object.keys(changes).filter((key) => !SOUND_OPTION_KEYS.includes(key));
	const problems = [...unknown.map((key) => `Unknown option "${key}"`), ...validateAudioOptions(changes)];
	if (problems.length > 0) {
		throw new ValidationError(null, problems);
	}
	/** @type {SoundChanges} */
	const normalized = {};
	if (typeof changes.title === 'string') {
		normalized.title = changes.title.trim();
	}
	if (typeof changes.gain === 'number') {
		normalized.gain = Math.round(changes.gain * 10_000) / 10_000;
	}
	return normalized;
}
