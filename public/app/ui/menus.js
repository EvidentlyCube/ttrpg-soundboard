import { t } from './text.js';

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
 * 	whether it offers to become the host or to stop being it, and whether a phone can connect; `started`: false while the splash asks how to start, when
 * 	only Info, Licenses and Change soundboard can do anything
 * @returns {MenuItem[]}
 */
export function appMenuItems({ hosting, started = true }) {
	return [
		hosting
			? { id: 'stopHosting', label: t('menu.stopHosting'), enabled: started, group: 1 }
			: { id: 'becomeHost', label: t('menu.becomeHost'), enabled: started, group: 1 },
		// A phone can only connect to a host, so the item is not there at all otherwise.
		...hosting ? [{ id: 'connectPhone', label: t('menu.connectPhone'), enabled: started, group: 1 }] : [],
		{ id: 'options', label: t('menu.options'), enabled: started, group: 2 },
		{ id: 'info', label: t('menu.info'), enabled: true, group: 2 },
		{ id: 'licenses', label: t('menu.licenses'), enabled: true, group: 2 },
		{ id: 'debug', label: t('menu.debug'), enabled: started, group: 2 },
		{ id: 'changeSoundboard', label: t('menu.changeSoundboard'), enabled: true, group: 3 },
	];
}

/**
 * The Selector's ☰ menu (DESIGN.md §9.18).
 * @returns {MenuItem[]}
 */
export function selectorMenuItems() {
	return [
		{ id: 'language', label: t('menu.language'), enabled: true, group: 0 },
		{ id: 'licenses', label: t('menu.licenses'), enabled: true, group: 0 },
	];
}

/**
 * The sound tile's context menu (DESIGN.md §9.3).
 * @param {boolean} isActive whether any instance of the sound is playing
 * @returns {MenuItem[]}
 */
export function soundMenuItems(isActive) {
	return [
		{ id: 'play', label: t('menu.play'), enabled: true, group: 0 },
		{ id: 'stopAll', label: t('menu.stopAll'), enabled: isActive, group: 0 },
		{ id: 'customize', label: t('menu.customize'), enabled: true, group: 1 },
		{ id: 'metadata', label: t('menu.metadata'), enabled: true, group: 1 },
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
		{ id: 'play', label: t('menu.play'), enabled: !active, group: 0 },
		{ id: 'playInstant', label: t('menu.playInstant'), enabled: !active, group: 0 },
		{ id: 'next', label: t('menu.next'), enabled: active, group: 1 },
		{ id: 'nextInstant', label: t('menu.nextInstant'), enabled: active, group: 1 },
		{ id: 'stop', label: t('menu.stop'), enabled: active, group: 2 },
		{ id: 'stopInstant', label: t('menu.stopInstant'), enabled: active, group: 2 },
		{ id: 'reset', label: t('menu.reset'), enabled: !active && resume !== null, group: 2 },
		{ id: 'customize', label: t('menu.customize'), enabled: true, group: 3 },
		{ id: 'metadata', label: t('menu.metadata'), enabled: true, group: 3 },
	];
}
