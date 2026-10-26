/** Control icons only (DESIGN.md §9): tiles never get icons. Drawn on a 24×24 grid in the current text color. */
const SHAPES = {
	play: '<path fill="currentColor" d="M8 5.5v13l10.5-6.5z"/>',
	pause: '<path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
	stop: '<rect fill="currentColor" x="6" y="6" width="12" height="12" rx="1.5"/>',
	previous: '<path fill="currentColor" d="M6 5h2.5v14H6zM19 5.5v13L9.5 12z"/>',
	next: '<path fill="currentColor" d="M15.5 5H18v14h-2.5zM5 5.5v13L14.5 12z"/>',
	volume: '<path fill="currentColor" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>'
		+ '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
	chevronDown: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 10l5 5 5-5"/>',
};

/** @typedef {keyof typeof SHAPES} IconName */

/**
 * @param {IconName} name
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function icon(name, className = 'size-5') {
	const template = document.createElement('template');
	template.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="${className}">${SHAPES[name]}</svg>`;
	return /** @type {SVGSVGElement} */ (template.content.firstElementChild);
}
