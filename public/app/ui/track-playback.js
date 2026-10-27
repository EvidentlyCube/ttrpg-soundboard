/** @typedef {import('../logic/playlist-player.js').PlaylistState} PlaylistState */

/**
 * What a track row in the playlist dialog shows (DESIGN.md §9.7): only the playlist's current track is ever playing
 * or paused. A loading track counts as playing, so the button already offers Stop.
 * @param {PlaylistState} state
 * @param {number | null} currentIndex
 * @param {number} index
 * @returns {'idle' | 'playing' | 'paused'}
 */
export function trackPlayback(state, currentIndex, index) {
	if (state === 'idle' || currentIndex !== index) {
		return 'idle';
	}
	return state === 'paused' ? 'paused' : 'playing';
}

/**
 * What pressing a row's button does.
 * @param {'idle' | 'playing' | 'paused'} playback
 * @returns {'start' | 'resume' | 'stop'}
 */
export function trackAction(playback) {
	if (playback === 'playing') {
		return 'stop';
	}
	return playback === 'paused' ? 'resume' : 'start';
}

/**
 * @param {number} position seconds
 * @param {number | null} duration seconds
 * @returns {number} 0..1
 */
export function progressFraction(position, duration) {
	if (duration === null || duration <= 0) {
		return 0;
	}
	return Math.min(1, Math.max(0, position / duration));
}

/**
 * The position in seconds a press at `clientX` on a progress bar asks for, or null when the bar can't seek.
 * @param {number} clientX
 * @param {{ left: number, width: number }} bar
 * @param {number | null} duration seconds
 * @returns {number | null}
 */
export function seekPosition(clientX, bar, duration) {
	if (duration === null || bar.width <= 0) {
		return null;
	}
	return progressFraction(clientX - bar.left, bar.width) * duration;
}
