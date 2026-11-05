import { h } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('./menus.js').MenuItem} MenuItem */
/** @typedef {import('./overlay.js').Overlay} Overlay */

/**
 * Opens a menu at the cursor. Choosing an item closes the menu before running it.
 * @param {Overlay} overlay
 * @param {MenuItem[]} items
 * @param {{ x: number, y: number }} point
 * @param {(id: string) => void} onSelect
 */
export function openContextMenu(overlay, items, point, onSelect) {
	const rows = items.flatMap((item, index) => [
		index > 0 && item.group !== items[index - 1].group
			? h('div', { role: 'separator', class: 'my-1 border-t border-line' })
			: null,
		h('button', {
			'type': 'button',
			'role': 'menuitem',
			'disabled': !item.enabled,
			'data-menu-item': item.id,
			'class': 'group flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-text outline-none enabled:cursor-pointer enabled:hover:bg-raised-hover enabled:focus-visible:bg-raised-hover disabled:text-muted/50',
			'onClick': () => {
				overlay.close();
				onSelect(item.id);
			},
		}, [icon(item.icon, 'size-4 text-muted group-disabled:text-muted/50'), item.label]),
	]);
	const panel = h('div', { role: 'menu', class: 'min-w-48 rounded-lg border border-line bg-panel py-1 shadow-xl shadow-black/50' }, rows);
	overlay.open(panel, point);
}
