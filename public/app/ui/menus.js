/** @typedef {import('../logic/playlist-player.js').PlaylistState} PlaylistState */

/**
 * @typedef {object} MenuItem
 * @property {string} id
 * @property {string} label
 * @property {boolean} enabled
 * @property {number} group items in different groups are separated by a divider
 */

/**
 * The sound tile's context menu (DESIGN.md §9.3).
 * @param {boolean} isActive whether any instance of the sound is playing
 * @returns {MenuItem[]}
 */
export function soundMenuItems(isActive) {
	return [
		{ id: 'play', label: 'Play', enabled: true, group: 0 },
		{ id: 'stopAll', label: 'Stop All', enabled: isActive, group: 0 },
		{ id: 'customize', label: 'Customize', enabled: true, group: 1 },
	];
}

/**
 * The playlist tile's context menu (DESIGN.md §9.3). Only the instant items get their own label; the plain ones follow
 * the playlist's rules.
 * @param {{ state: PlaylistState, resume: unknown }} snapshot `resume` is set while a stopped playlist remembers where
 * 	it will resume
 * @returns {MenuItem[]}
 */
export function playlistMenuItems({ state, resume }) {
	const active = state !== 'idle';
	return [
		{ id: 'play', label: 'Play', enabled: !active, group: 0 },
		{ id: 'playInstant', label: 'Play (Instant)', enabled: !active, group: 0 },
		{ id: 'next', label: 'Next', enabled: active, group: 1 },
		{ id: 'nextInstant', label: 'Next (Instant)', enabled: active, group: 1 },
		{ id: 'stop', label: 'Stop', enabled: active, group: 2 },
		{ id: 'stopInstant', label: 'Stop (Instant)', enabled: active, group: 2 },
		{ id: 'reset', label: 'Reset', enabled: !active && resume !== null, group: 2 },
		{ id: 'customize', label: 'Customize', enabled: true, group: 3 },
	];
}
