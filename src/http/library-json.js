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
		sounds: library.sounds.map(toSoundJson),
	};
}

/** @param {import('../library/library.js').Playlist} playlist */
export function toPlaylistJson(playlist) {
	const { id, title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode, tracks } = playlist;
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
		...imageJson('playlist', playlist),
		tracks: tracks.map(toFileJson),
	};
}

/**
 * A sound: a file, plus the image its tile shows.
 * @param {import('../library/library.js').AudioFile} sound
 */
export function toSoundJson(sound) {
	return { ...toFileJson(sound), ...imageJson('sound', sound) };
}

/**
 * @param {import('./background-routes.js').OwnerKind} kind
 * @param {{ id: string, background: import('../library/backgrounds.js').Background | null }
 * 	& import('../library/validate.js').BackgroundStyle} item
 */
function imageJson(kind, item) {
	const { id, background, imageColorOpacity, imageBlur, titleShadowOpacity, titleShadowBlur, titleShadowOffset } = item;
	return {
		background: background && {
			url: backgroundUrl(kind, id, background),
			version: backgroundVersion(background),
			width: background.width,
			height: background.height,
		},
		imageColorOpacity,
		imageBlur,
		titleShadowOpacity,
		titleShadowBlur,
		titleShadowOffset,
	};
}

/** @param {import('../library/library.js').AudioFile} file */
export function toFileJson({ id, title, format, size, gain, duration, startAt, endAt, fadeIn, fadeOut, source }) {
	return { id, title, format, size, gain, duration, startAt, endAt, fadeIn, fadeOut, url: mediaUrl(id), source };
}
