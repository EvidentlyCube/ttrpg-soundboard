import { h } from './dom.js';

const ERROR_FLASH_MS = 2000;

/** Colors written out in full so Tailwind generates them (DESIGN.md §9.6). */
const ADD_ACCENTS = {
	music: 'text-music hover:bg-music/15',
	sfx: 'text-sfx hover:bg-sfx/15',
};

/**
 * A titled section whose tiles wrap in columns of at least 10rem, with an add button next to the title.
 * @param {string} title
 * @param {{ label: string, accent: keyof typeof ADD_ACCENTS, onClick: () => void }} add
 * @returns {{ section: HTMLElement, grid: HTMLElement }}
 */
export function tileGrid(title, add) {
	const grid = h('div', { class: 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3' });
	const button = h('button', {
		'type': 'button',
		'class': `cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium ${ADD_ACCENTS[add.accent]}`,
		'data-add-button': add.accent,
		'onClick': add.onClick,
	}, `+ ${add.label}`);
	const section = h('section', { class: 'space-y-3' },
		h('div', { class: 'flex items-center gap-3' }, h('h2', { class: 'text-xs font-semibold uppercase tracking-widest text-muted' }, title), button),
		grid);
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
