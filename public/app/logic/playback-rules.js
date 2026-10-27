/** @typedef {import('./ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */

/**
 * How a playlist plays (DESIGN.md §8.2). Fades are in seconds.
 * @typedef {object} PlaybackRules
 * @property {import('./order-strategies.js').PlaybackOrder} order
 * @property {boolean} playlistLooping whether the play history is extended once its first fill runs out
 * @property {boolean} trackLooping whether the current track repeats until the user moves on
 * @property {number} fadeIn applied when the playlist starts
 * @property {number} fadeOut applied when the playlist stops
 * @property {number} crossfade applied when the track changes
 */

/** @type {Readonly<PlaybackRules>} */
export const DEFAULT_PLAYBACK_RULES = Object.freeze({
	order: 'ordered',
	playlistLooping: true,
	trackLooping: false,
	fadeIn: 0,
	fadeOut: 0,
	crossfade: 0,
});

/** The longest crossfade, fade-in or fade-out a playlist may have, in seconds; the server enforces the same limit. */
export const MAX_CROSSFADE = 30;

/**
 * The single place where per-playlist rules are read from the playlist's options. Rules without an option of their
 * own keep the defaults.
 * @param {PlaylistJson} playlist
 * @returns {Readonly<PlaybackRules>}
 */
export function resolvePlaybackRules(playlist) {
	const { crossfade, fadeIn, fadeOut, order, trackLooping } = playlist;
	return { ...DEFAULT_PLAYBACK_RULES, crossfade, fadeIn, fadeOut, order, trackLooping };
}

/**
 * Where a track starts and ends; `endAt: null` means its natural end.
 * @param {AudioFileJson} _track
 * @param {Readonly<PlaybackRules>} _rules
 * @returns {{ startAt: number, endAt: number | null }}
 */
export function planTrack(_track, _rules) {
	return { startAt: 0, endAt: null };
}
