import { mediaUrl } from './media.js';

/** @typedef {import('../library/library.js').Library} Library */

const LIBRARY_FORMAT_VERSION = 1;

/**
 * The `/api/library` format (DESIGN.md §5.2).
 * @param {Library} library
 */
export function toLibraryJson(library) {
	return {
		version: LIBRARY_FORMAT_VERSION,
		playlists: library.playlists.map(toPlaylistJson),
		sounds: library.sounds.map(toFileJson),
	};
}

/** @param {import('../library/library.js').Playlist} playlist */
export function toPlaylistJson({ id, title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode, tracks }) {
	return { id, title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode, tracks: tracks.map(toFileJson) };
}

/** @param {import('../library/library.js').AudioFile} file */
export function toFileJson({ id, title, format, size, gain, duration, startAt, endAt, fadeIn, fadeOut, source }) {
	return { id, title, format, size, gain, duration, startAt, endAt, fadeIn, fadeOut, url: mediaUrl(id), source };
}
