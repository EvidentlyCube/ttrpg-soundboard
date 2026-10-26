import { InvalidCommandError } from './errors.js';
import { MAX_CROSSFADE } from './playback-rules.js';
import { sortBy } from './sort.js';
import { MAX_GAIN } from './volume.js';

/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').AudioFormat} AudioFormat */
/** @typedef {import('./ports.js').LibraryJson} LibraryJson */
/** @typedef {import('./ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('./ports.js').ItemOptions} ItemOptions */

/** The library sent by the server, indexed for lookups and checked against what this browser can play. */
export class LibraryModel {
	#json;
	/** @type {Map<string, PlaylistJson>} */
	#playlists;
	/** @type {Map<string, AudioFileJson>} */
	#sounds;
	/** @type {Set<string>} */
	#unplayable;

	/**
	 * @param {LibraryJson} json
	 * @param {(format: AudioFormat) => boolean} canPlay
	 */
	constructor(json, canPlay) {
		this.#json = json;
		this.#playlists = new Map(json.playlists.map((playlist) => [playlist.id, playlist]));
		this.#sounds = new Map(json.sounds.map((sound) => [sound.id, sound]));
		const files = [...json.playlists.flatMap((playlist) => playlist.tracks), ...json.sounds];
		this.#unplayable = new Set(files.filter((file) => !canPlay(file.format)).map((file) => file.id));
	}

	get json() {
		return this.#json;
	}

	/** @returns {string[]} ids of sounds and tracks in a format this browser cannot play */
	get unplayable() {
		return [...this.#unplayable];
	}

	/** @param {string} id */
	playlist(id) {
		const playlist = this.#playlists.get(id);
		if (!playlist) {
			throw new InvalidCommandError(`Unknown playlist "${id}"`);
		}
		return playlist;
	}

	/** @param {string} id */
	sound(id) {
		const sound = this.#sounds.get(id);
		if (!sound) {
			throw new InvalidCommandError(`Unknown sound "${id}"`);
		}
		return sound;
	}

	/** @param {AudioFileJson} file */
	isPlayable(file) {
		return !this.#unplayable.has(file.id);
	}

	/**
	 * Replaces the sound with a changed copy and keeps the sounds sorted by title. Earlier `json` snapshots are left as
	 * they were, since the UI may still hold them.
	 * @param {string} id
	 * @param {ItemOptions} changes
	 * @returns {AudioFileJson} the changed sound
	 */
	updateSound(id, changes) {
		const sound = applyChanges(this.sound(id), changes);
		this.#sounds.set(id, sound);
		this.#json = {
			...this.#json,
			sounds: sortBy(this.#json.sounds.map((entry) => (entry.id === id ? sound : entry)), (entry) => entry.title),
		};
		return sound;
	}

	/**
	 * Like `updateSound`, for a playlist; its tracks are unchanged.
	 * @param {string} id
	 * @param {ItemOptions} changes
	 * @returns {PlaylistJson} the changed playlist
	 */
	updatePlaylist(id, changes) {
		const timings = { crossfade: 'Crossfade', fadeIn: 'Fade-in', fadeOut: 'Fade-out' };
		const playlist = applyChanges(this.playlist(id), changes);
		for (const [key, name] of /** @type {[keyof typeof timings, string][]} */ (Object.entries(timings))) {
			const seconds = changes[key];
			if (seconds !== undefined) {
				if (!(seconds >= 0 && seconds <= MAX_CROSSFADE)) {
					throw new InvalidCommandError(`${name} must be a number of seconds from 0 to ${MAX_CROSSFADE}, got ${seconds}`);
				}
				playlist[key] = seconds;
			}
		}
		this.#playlists.set(id, playlist);
		this.#json = {
			...this.#json,
			playlists: sortBy(this.#json.playlists.map((entry) => (entry.id === id ? playlist : entry)), (entry) => entry.title),
		};
		return playlist;
	}
}

/**
 * A copy of the item with a trimmed title and a gain applied.
 * @template {{ title: string, gain: number }} T
 * @param {T} item
 * @param {ItemOptions} changes
 * @returns {T}
 */
function applyChanges(item, { title, gain }) {
	const trimmed = title?.trim();
	if (trimmed === '') {
		throw new InvalidCommandError('A title cannot be empty');
	}
	if (gain !== undefined && !(gain >= 0 && gain <= MAX_GAIN)) {
		throw new InvalidCommandError(`Gain must be a number from 0 to ${MAX_GAIN}, got ${gain}`);
	}
	return { ...item, title: trimmed ?? item.title, gain: gain ?? item.gain };
}
