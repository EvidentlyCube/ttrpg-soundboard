import { BACKGROUND_STYLE_KEYS, BACKGROUND_STYLE_LIMITS } from './background-style.js';
import { checkClip, roundToMilliseconds } from './clip.js';
import { InvalidCommandError } from './errors.js';
import { PLAYBACK_ORDERS } from './order-strategies.js';
import { MAX_CROSSFADE, STOP_MODES } from './playback-rules.js';
import { sortBy } from './sort.js';
import { MAX_GAIN } from './volume.js';

/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').SoundJson} SoundJson */
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
	/** @type {Map<string, SoundJson>} */
	#sounds;
	/** @type {Set<string>} */
	#unplayable;
	#canPlay;

	/**
	 * @param {LibraryJson} json
	 * @param {(format: AudioFormat) => boolean} canPlay
	 */
	constructor(json, canPlay) {
		this.#json = json;
		this.#canPlay = canPlay;
		this.#playlists = new Map(json.playlists.map((playlist) => [playlist.id, playlist]));
		this.#sounds = new Map(json.sounds.map((sound) => [sound.id, sound]));
		const files = [...json.playlists.flatMap((playlist) => playlist.tracks), ...json.sounds];
		this.#unplayable = new Set(files.filter((file) => !canPlay(file.format)).map((file) => file.id));
	}

	/** @param {string} id */
	hasSound(id) {
		return this.#sounds.has(id);
	}

	/** @param {string} id */
	hasPlaylist(id) {
		return this.#playlists.has(id);
	}

	/**
	 * Adds a sound the server just added (a download), in title order.
	 * @param {SoundJson} sound
	 */
	addSound(sound) {
		this.#checkPlayable(sound);
		this.#sounds.set(sound.id, sound);
		this.#json = { ...this.#json, sounds: sortBy([...this.#json.sounds, sound], (entry) => entry.title) };
	}

	/**
	 * Adds a playlist the server just created, in title order.
	 * @param {PlaylistJson} playlist
	 */
	addPlaylist(playlist) {
		playlist.tracks.forEach((track) => this.#checkPlayable(track));
		this.#playlists.set(playlist.id, playlist);
		this.#json = { ...this.#json, playlists: sortBy([...this.#json.playlists, playlist], (entry) => entry.title) };
	}

	/**
	 * Takes the tracks a playlist gained on the server into a copy of the playlist here, in path order. Everything else
	 * is kept as it is here, so a change not saved yet isn't undone.
	 * @param {PlaylistJson} fromServer
	 * @returns {PlaylistJson} the playlist with its new tracks
	 */
	addTracks(fromServer) {
		const current = this.playlist(fromServer.id);
		const known = new Set(current.tracks.map((track) => track.id));
		const added = fromServer.tracks.filter((track) => !known.has(track.id));
		added.forEach((track) => this.#checkPlayable(track));
		const playlist = { ...current, tracks: sortBy([...current.tracks, ...added], (track) => track.id) };
		this.#playlists.set(playlist.id, playlist);
		this.#json = { ...this.#json, playlists: this.#json.playlists.map((entry) => (entry.id === playlist.id ? playlist : entry)) };
		return playlist;
	}

	/**
	 * Removes a sound the server deleted or moved away.
	 * @param {string} id
	 */
	removeSound(id) {
		this.#sounds.delete(id);
		this.#unplayable.delete(id);
		this.#json = { ...this.#json, sounds: this.#json.sounds.filter((entry) => entry.id !== id) };
	}

	/**
	 * Removes a playlist the server deleted, with its tracks.
	 * @param {string} id
	 */
	removePlaylist(id) {
		for (const track of this.#playlists.get(id)?.tracks ?? []) {
			this.#unplayable.delete(track.id);
		}
		this.#playlists.delete(id);
		this.#json = { ...this.#json, playlists: this.#json.playlists.filter((entry) => entry.id !== id) };
	}

	/**
	 * Removes a track the server deleted or moved away from a copy of its playlist.
	 * @param {string} playlistId
	 * @param {string} trackId
	 * @returns {PlaylistJson | null} the playlist without it, or null when the track isn't known here
	 */
	removeTrack(playlistId, trackId) {
		const current = this.#playlists.get(playlistId);
		if (!current?.tracks.some((track) => track.id === trackId)) {
			return null;
		}
		this.#unplayable.delete(trackId);
		const playlist = { ...current, tracks: current.tracks.filter((track) => track.id !== trackId) };
		this.#playlists.set(playlist.id, playlist);
		this.#json = { ...this.#json, playlists: this.#json.playlists.map((entry) => (entry.id === playlist.id ? playlist : entry)) };
		return playlist;
	}

	/** @param {AudioFileJson} file */
	#checkPlayable(file) {
		if (!this.#canPlay(file.format)) {
			this.#unplayable.add(file.id);
		}
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
	 * @returns {SoundJson} the changed sound
	 */
	updateSound(id, changes) {
		const sound = changedSound(this.sound(id), changes);
		this.#storeSounds([sound]);
		return sound;
	}

	/**
	 * Applies the same change to every sound. Every copy is checked before any is stored, so an invalid change changes
	 * nothing. Sounds that already have those values are left alone.
	 * @param {ItemOptions} changes
	 * @returns {SoundJson[]} the sounds that changed
	 */
	updateAllSounds(changes) {
		const sounds = this.#json.sounds.flatMap((sound) => {
			const changed = changedSound(sound, changes);
			return differs(sound, changed, changes) ? [changed] : [];
		});
		this.#storeSounds(sounds);
		return sounds;
	}

	/** @param {SoundJson[]} changed */
	#storeSounds(changed) {
		const byId = new Map(changed.map((sound) => [sound.id, sound]));
		for (const sound of changed) {
			this.#sounds.set(sound.id, sound);
		}
		this.#json = {
			...this.#json,
			sounds: sortBy(this.#json.sounds.map((entry) => byId.get(entry.id) ?? entry), (entry) => entry.title),
		};
	}

	/**
	 * Renames a track or changes its points. Its playlist is replaced by a copy holding the changed track, in the same
	 * order, so everything that shows the playlist can take the new copy.
	 * @param {string} trackId
	 * @param {ItemOptions} changes only `title`, `gain`, `startAt` and `endAt` are used
	 * @returns {{ playlist: PlaylistJson, track: AudioFileJson }}
	 */
	updateTrack(trackId, { title, gain, startAt, endAt }) {
		const current = this.#json.playlists.find((entry) => entry.tracks.some((track) => track.id === trackId));
		if (!current) {
			throw new InvalidCommandError(`Unknown track "${trackId}"`);
		}
		const index = current.tracks.findIndex((track) => track.id === trackId);
		const track = applyChanges(current.tracks[index], { title, gain });
		applyPoints(track, { startAt, endAt });
		const playlist = { ...current, tracks: current.tracks.with(index, track) };
		this.#playlists.set(playlist.id, playlist);
		this.#json = { ...this.#json, playlists: this.#json.playlists.map((entry) => (entry.id === playlist.id ? playlist : entry)) };
		return { playlist, track };
	}

	/**
	 * Takes a playlist's new image from the server into a copy of the playlist here. Its settings stay as they are
	 * here, so a change not saved yet isn't undone.
	 * @param {string} id
	 * @param {import('./ports.js').BackgroundJson | null} background
	 * @returns {PlaylistJson}
	 */
	setBackground(id, background) {
		const playlist = { ...this.playlist(id), background };
		this.#playlists.set(id, playlist);
		this.#json = { ...this.#json, playlists: this.#json.playlists.map((entry) => (entry.id === id ? playlist : entry)) };
		return playlist;
	}

	/**
	 * Like `setBackground`, for a sound.
	 * @param {string} id
	 * @param {import('./ports.js').BackgroundJson | null} background
	 * @returns {SoundJson}
	 */
	setSoundBackground(id, background) {
		const sound = { ...this.sound(id), background };
		this.#sounds.set(id, sound);
		this.#json = { ...this.#json, sounds: this.#json.sounds.map((entry) => (entry.id === id ? sound : entry)) };
		return sound;
	}

	/**
	 * Like `updateSound`, for a playlist; its tracks are unchanged.
	 * @param {string} id
	 * @param {ItemOptions} changes
	 * @returns {PlaylistJson} the changed playlist
	 */
	updatePlaylist(id, changes) {
		const playlist = changedPlaylist(this.playlist(id), changes);
		this.#storePlaylists([playlist]);
		return playlist;
	}

	/**
	 * Like `updateAllSounds`, for every playlist.
	 * @param {ItemOptions} changes
	 * @returns {PlaylistJson[]} the playlists that changed
	 */
	updateAllPlaylists(changes) {
		const playlists = this.#json.playlists.flatMap((playlist) => {
			const changed = changedPlaylist(playlist, changes);
			return differs(playlist, changed, changes) ? [changed] : [];
		});
		this.#storePlaylists(playlists);
		return playlists;
	}

	/** @param {PlaylistJson[]} changed */
	#storePlaylists(changed) {
		const byId = new Map(changed.map((playlist) => [playlist.id, playlist]));
		for (const playlist of changed) {
			this.#playlists.set(playlist.id, playlist);
		}
		this.#json = {
			...this.#json,
			playlists: sortBy(this.#json.playlists.map((entry) => byId.get(entry.id) ?? entry), (entry) => entry.title),
		};
	}
}

/**
 * @param {object} before
 * @param {object} after
 * @param {ItemOptions} changes
 * @returns {boolean} whether any setting given in `changes` has a new value
 */
function differs(before, after, changes) {
	const keys = Object.entries(changes).filter(([, value]) => value !== undefined).map(([key]) => key);
	return keys.some((key) => /** @type {Record<string, unknown>} */ (before)[key] !== /** @type {Record<string, unknown>} */ (after)[key]);
}

/**
 * @param {SoundJson} current
 * @param {ItemOptions} changes
 * @returns {SoundJson} a checked, changed copy
 */
function changedSound(current, changes) {
	const sound = applyChanges(current, changes);
	applyTimings(sound, changes, { fadeIn: 'Fade-in', fadeOut: 'Fade-out' });
	applyPoints(sound, changes);
	applyStyle(sound, changes);
	return sound;
}

/**
 * @param {PlaylistJson} current
 * @param {ItemOptions} changes
 * @returns {PlaylistJson} a checked, changed copy
 */
function changedPlaylist(current, changes) {
	const playlist = applyChanges(current, changes);
	applyTimings(playlist, changes, { crossfade: 'Crossfade', fadeIn: 'Fade-in', fadeOut: 'Fade-out' });
	if (changes.order !== undefined) {
		if (!PLAYBACK_ORDERS.includes(changes.order)) {
			throw new InvalidCommandError(`The order must be one of ${PLAYBACK_ORDERS.join(', ')}, got ${changes.order}`);
		}
		playlist.order = changes.order;
	}
	if (changes.playlistLooping !== undefined) {
		playlist.playlistLooping = changes.playlistLooping;
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
	applyStyle(playlist, changes);
	return playlist;
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

/**
 * Sets the image settings given in `changes`, each checked against its limit.
 * @param {import('./background-style.js').BackgroundStyle} item changed in place
 * @param {ItemOptions} changes
 */
function applyStyle(item, changes) {
	for (const key of BACKGROUND_STYLE_KEYS) {
		const value = changes[key];
		if (value !== undefined) {
			if (!(value >= 0 && value <= BACKGROUND_STYLE_LIMITS[key])) {
				throw new InvalidCommandError(`${key} must be a number from 0 to ${BACKGROUND_STYLE_LIMITS[key]}, got ${value}`);
			}
			item[key] = value;
		}
	}
}
