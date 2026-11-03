/** @typedef {import('../logic/playlist-player.js').PlaylistState} PlaylistState */

/**
 * @typedef {object} MenuItem
 * @property {string} id
 * @property {string} label
 * @property {boolean} enabled
 * @property {number} group items in different groups are separated by a divider
 */

/**
 * The header's app menu (DESIGN.md §9.1).
 * @param {{ hosting: boolean, started?: boolean }} state `hosting`: whether remotes control this page, which decides
 * 	whether it offers to become the host or to stop being it; `started`: false while the splash asks how to start, when
 * 	only Info and Change soundboard can do anything
 * @returns {MenuItem[]}
 */
export function appMenuItems({ hosting, started = true }) {
	return [
		{ id: 'regenerateWaves', label: 'Regenerate waveforms', enabled: started, group: 0 },
		hosting
			? { id: 'stopHosting', label: 'Stop hosting', enabled: started, group: 1 }
			: { id: 'becomeHost', label: 'Become host', enabled: started, group: 1 },
		{ id: 'connectPhone', label: 'Connect a phone', enabled: started, group: 1 },
		{ id: 'options', label: 'Options', enabled: started, group: 2 },
		{ id: 'info', label: 'Info', enabled: true, group: 2 },
		{ id: 'changeSoundboard', label: 'Change soundboard', enabled: true, group: 3 },
	];
}

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
		{ id: 'metadata', label: 'Metadata', enabled: true, group: 1 },
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
		{ id: 'metadata', label: 'Metadata', enabled: true, group: 3 },
	];
}
