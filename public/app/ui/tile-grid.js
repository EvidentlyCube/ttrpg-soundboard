import { h } from './dom.js';

/** Classes every tile shares; each kind adds its accent color and active styling through `data-*` variants. */
export const TILE_CLASS = 'flex min-h-24 w-full flex-col items-start justify-between gap-2 rounded-lg border border-l-4 border-line bg-raised p-3 text-left text-text transition-colors '
	+ 'enabled:cursor-pointer enabled:hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-40 '
	+ 'data-[error=true]:ring-2 data-[error=true]:ring-danger';

const ERROR_FLASH_MS = 2000;

/**
 * A titled section whose tiles wrap in columns of at least 10rem.
 * @param {string} title
 * @returns {{ section: HTMLElement, grid: HTMLElement }}
 */
export function tileGrid(title) {
	const grid = h('div', { class: 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3' });
	const section = h('section', { class: 'space-y-3' }, h('h2', { class: 'text-xs font-semibold uppercase tracking-widest text-muted' }, title), grid);
	return { section, grid };
}

/**
 * Briefly marks a tile as failed (DESIGN.md §7).
 * @param {HTMLElement} element
 */
export function flashError(element) {
	element.dataset.error = 'true';
	window.setTimeout(() => {
		delete element.dataset.error;
	}, ERROR_FLASH_MS);
}
