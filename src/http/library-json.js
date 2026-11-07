import { backgroundUrl, backgroundVersion } from './background-routes.js';
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
export function toPlaylistJson(playlist) {
	const { id, title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode, tracks, background } = playlist;
	const { imageColorOpacity, imageBlur, titleShadowOpacity, titleShadowBlur, titleShadowOffset } = playlist;
	return {
		id,
		title,
		gain,
		crossfade,
		fadeIn,
		fadeOut,
		order,
		playlistLooping,
		trackLooping,
		stopMode,
		background: background && {
			url: backgroundUrl(id, background),
			version: backgroundVersion(background),
			width: background.width,
			height: background.height,
		},
		imageColorOpacity,
		imageBlur,
		titleShadowOpacity,
		titleShadowBlur,
		titleShadowOffset,
		tracks: tracks.map(toFileJson),
	};
}

/** @param {import('../library/library.js').AudioFile} file */
export function toFileJson({ id, title, format, size, gain, duration, startAt, endAt, fadeIn, fadeOut, source }) {
	return { id, title, format, size, gain, duration, startAt, endAt, fadeIn, fadeOut, url: mediaUrl(id), source };
}
