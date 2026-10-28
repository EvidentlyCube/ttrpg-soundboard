import { checkClip, roundToMilliseconds } from './clip.js';
import { InvalidCommandError } from './errors.js';
import { PLAYBACK_ORDERS } from './order-strategies.js';
import { MAX_CROSSFADE, STOP_MODES } from './playback-rules.js';
import { sortBy } from './sort.js';
import { MAX_GAIN } from './volume.js';

/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').AudioFormat} AudioFormat */
/** @typedef {import('./ports.js').LibraryJson} LibraryJson */
/** @typedef {import('./ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('./ports.js').ItemOptions} ItemOptions */
/** @typedef {'crossfade' | 'fadeIn' | 'fadeOut'} TimingKey */

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
		applyTimings(sound, changes, { fadeIn: 'Fade-in', fadeOut: 'Fade-out' });
		applyPoints(sound, changes);
		this.#sounds.set(id, sound);
		this.#json = {
			...this.#json,
			sounds: sortBy(this.#json.sounds.map((entry) => (entry.id === id ? sound : entry)), (entry) => entry.title),
		};
		return sound;
	}

	/**
	 * Renames a track or changes its points. Its playlist is replaced by a copy holding the changed track, in the same
	 * order, so everything that shows the playlist can take the new copy.
	 * @param {string} trackId
	 * @param {ItemOptions} changes only `title`, `startAt` and `endAt` are used
	 * @returns {{ playlist: PlaylistJson, track: AudioFileJson }}
	 */
	updateTrack(trackId, { title, startAt, endAt }) {
		const current = this.#json.playlists.find((entry) => entry.tracks.some((track) => track.id === trackId));
		if (!current) {
			throw new InvalidCommandError(`Unknown track "${trackId}"`);
		}
		const index = current.tracks.findIndex((track) => track.id === trackId);
		const track = applyChanges(current.tracks[index], { title });
		applyPoints(track, { startAt, endAt });
		const playlist = { ...current, tracks: current.tracks.with(index, track) };
		this.#playlists.set(playlist.id, playlist);
		this.#json = { ...this.#json, playlists: this.#json.playlists.map((entry) => (entry.id === playlist.id ? playlist : entry)) };
		return { playlist, track };
	}

	/**
	 * Like `updateSound`, for a playlist; its tracks are unchanged.
	 * @param {string} id
	 * @param {ItemOptions} changes
	 * @returns {PlaylistJson} the changed playlist
	 */
	updatePlaylist(id, changes) {
		const playlist = applyChanges(this.playlist(id), changes);
		applyTimings(playlist, changes, { crossfade: 'Crossfade', fadeIn: 'Fade-in', fadeOut: 'Fade-out' });
		if (changes.order !== undefined) {
			if (!PLAYBACK_ORDERS.includes(changes.order)) {
				throw new InvalidCommandError(`The order must be one of ${PLAYBACK_ORDERS.join(', ')}, got ${changes.order}`);
			}
			playlist.order = changes.order;
		}
		if (changes.trackLooping !== undefined) {
			playlist.trackLooping = changes.trackLooping;
		}
		if (changes.stopMode !== undefined) {
			if (!STOP_MODES.includes(changes.stopMode)) {
				throw new InvalidCommandError(`The stop mode must be one of ${STOP_MODES.join(', ')}, got ${changes.stopMode}`);
			}
			playlist.stopMode = changes.stopMode;
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

/**
 * Sets the start and end points given in `changes`, rounded to milliseconds. They are checked after merging, so a
 * change to one point must still fit the other.
 * @param {{ startAt: number, endAt: number | null }} item changed in place
 * @param {ItemOptions} changes
 */
function applyPoints(item, changes) {
	const startAt = changes.startAt === undefined ? item.startAt : roundToMilliseconds(changes.startAt);
	let { endAt } = item;
	if (changes.endAt !== undefined) {
		endAt = changes.endAt === null ? null : roundToMilliseconds(changes.endAt);
	}
	checkClip(startAt, endAt);
	item.startAt = startAt;
	item.endAt = endAt;
}

/**
 * Sets the fades or crossfade given in `changes` on the item, each checked to be from 0 to MAX_CROSSFADE seconds.
 * @param {Partial<Record<TimingKey, number>>} item changed in place
 * @param {ItemOptions} changes
 * @param {Partial<Record<TimingKey, string>>} names the keys to take, with the names used in error messages
 */
function applyTimings(item, changes, names) {
	for (const [key, name] of /** @type {[TimingKey, string][]} */ (Object.entries(names))) {
		const seconds = changes[key];
		if (seconds !== undefined) {
			if (!(seconds >= 0 && seconds <= MAX_CROSSFADE)) {
				throw new InvalidCommandError(`${name} must be a number of seconds from 0 to ${MAX_CROSSFADE}, got ${seconds}`);
			}
			item[key] = seconds;
		}
	}
}
