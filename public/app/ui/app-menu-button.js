import { openContextMenu } from './context-menu.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from './text.js';

/** @typedef {import('./overlay.js').Overlay} Overlay */

/**
 * The header's ☰ button, which opens the app menu below itself: the board's (DESIGN.md §9.3) and the Selector's (§9.18).
 * @param {Overlay} overlay
 * @param {() => import('./menus.js').MenuItem[]} items
 * @param {(id: string) => void} onSelect
 */
export function appMenuButton(overlay, items, onSelect) {
	const button = h('button', {
		'type': 'button',
		'class': 'grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised-hover hover:text-text focus-visible:outline-2 focus-visible:outline-music',
		'title': t('header.menu'),
		'aria-label': t('header.menu'),
		'aria-haspopup': 'menu',
		'data-app-menu': true,
		'onClick': () => {
			const { left, bottom } = button.getBoundingClientRect();
			openContextMenu(overlay, items(), { x: left, y: bottom + 4 }, onSelect);
		},
	}, icon('menu', 'size-5'));
	return button;
}
