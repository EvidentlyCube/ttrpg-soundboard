import { h } from './dom.js';

/** @typedef {import('./icon-names.js').IconName} IconName */
/** @typedef {'solid' | 'regular'} IconStyle */

/**
 * A control or status icon (DESIGN.md §9): tiles get none, except the playlist tile's turned-down volume bubble.
 * Drawn in the current text color. The file is a CSS mask over a `currentColor` background, since an SVG loaded by
 * URL as an image can't take the text color.
 * @param {IconName} name
 * @param {string} [className]
 * @param {IconStyle} [style]
 * @returns {HTMLSpanElement}
 */
export function icon(name, className = 'size-5', style = 'solid') {
	const element = h('span', { 'class': `inline-block shrink-0 bg-current ${className}`, 'aria-hidden': 'true' });
	element.style.setProperty('mask', `url(/vendor/fontawesome/svgs-full/${style}/${name}.svg) center / contain no-repeat`);
	return element;
}
