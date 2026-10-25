import { InvalidCommandError } from './errors.js';

/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').AudioFormat} AudioFormat */
/** @typedef {import('./ports.js').LibraryJson} LibraryJson */
/** @typedef {import('./ports.js').PlaylistJson} PlaylistJson */

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
}
