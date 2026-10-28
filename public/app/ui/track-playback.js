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
