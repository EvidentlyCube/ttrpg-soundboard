import { t } from './text.js';

/** @typedef {import('../logic/playlist-player.js').PlaylistState} PlaylistState */
/** @typedef {import('./icon-names.js').IconName} IconName */

/**
 * @typedef {object} MenuItem
 * @property {string} id
 * @property {string} label
 * @property {IconName} icon
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
	/** @type {MenuItem} */
	const connectPhone = { id: 'connectPhone', label: t('menu.connectPhone'), icon: 'mobile-screen', enabled: started, group: 1 };
	return [
		hosting
			? { id: 'stopHosting', label: t('menu.stopHosting'), icon: 'link-slash', enabled: started, group: 1 }
			: { id: 'becomeHost', label: t('menu.becomeHost'), icon: 'tower-broadcast', enabled: started, group: 1 },
		// A phone can only connect to a host, so the item is not there at all otherwise.
		...hosting ? [connectPhone] : [],
		{ id: 'options', label: t('menu.options'), icon: 'gear', enabled: started, group: 2 },
		{ id: 'info', label: t('menu.info'), icon: 'circle-info', enabled: true, group: 2 },
		{ id: 'licenses', label: t('menu.licenses'), icon: 'scale-balanced', enabled: true, group: 2 },
		{ id: 'debug', label: t('menu.debug'), icon: 'bug', enabled: started, group: 2 },
		{ id: 'changeSoundboard', label: t('menu.changeSoundboard'), icon: 'folder-open', enabled: true, group: 3 },
	];
}

/**
 * The Selector's ☰ menu (DESIGN.md §9.18).
 * @returns {MenuItem[]}
 */
export function selectorMenuItems() {
	return [
		{ id: 'language', label: t('menu.language'), icon: 'language', enabled: true, group: 0 },
		{ id: 'licenses', label: t('menu.licenses'), icon: 'scale-balanced', enabled: true, group: 0 },
	];
}

/**
 * The sound tile's context menu (DESIGN.md §9.3).
 * @param {boolean} isActive whether any instance of the sound is playing
 * @returns {MenuItem[]}
 */
export function soundMenuItems(isActive) {
	return [
		{ id: 'play', label: t('menu.play'), icon: 'play', enabled: true, group: 0 },
		{ id: 'stopAll', label: t('menu.stopAll'), icon: 'stop', enabled: isActive, group: 0 },
		{ id: 'customize', label: t('menu.customize'), icon: 'sliders', enabled: true, group: 1 },
		{ id: 'metadata', label: t('menu.metadata'), icon: 'file-lines', enabled: true, group: 1 },
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
		{ id: 'play', label: t('menu.play'), icon: 'play', enabled: !active, group: 0 },
		{ id: 'playInstant', label: t('menu.playInstant'), icon: 'bolt', enabled: !active, group: 0 },
		{ id: 'next', label: t('menu.next'), icon: 'forward-step', enabled: active, group: 1 },
		{ id: 'nextInstant', label: t('menu.nextInstant'), icon: 'bolt', enabled: active, group: 1 },
		{ id: 'stop', label: t('menu.stop'), icon: 'stop', enabled: active, group: 2 },
		{ id: 'stopInstant', label: t('menu.stopInstant'), icon: 'bolt', enabled: active, group: 2 },
		{ id: 'reset', label: t('menu.reset'), icon: 'rotate-left', enabled: !active && resume !== null, group: 2 },
		{ id: 'customize', label: t('menu.customize'), icon: 'sliders', enabled: true, group: 3 },
		{ id: 'metadata', label: t('menu.metadata'), icon: 'file-lines', enabled: true, group: 3 },
	];
}
