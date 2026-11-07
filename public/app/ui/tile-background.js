import { STATUS_BAND_EXTRA_OPACITY } from '../logic/background-style.js';
import { h } from './dom.js';

/** @typedef {import('../logic/background-style.js').BackgroundStyle} BackgroundStyle */

/**
 * The layers that put a tile's image under its color (DESIGN.md §9.1), for a tile with Tailwind's `group`, `relative`,
 * `isolate` and `overflow-hidden`: the image, a blur of it, then the color. The blur has a layer of its own because an
 * element's opacity also fades its backdrop filter, and the blur must not fade with the color. Every value that a
 * slider moves is set inline (DESIGN.md §9.6).
 */
export class TileBackground {
	#image = h('span', { 'class': 'pointer-events-none absolute inset-0 -z-30 bg-cover bg-center', 'data-tile-image': true, 'hidden': true });
	#blur = h('span', { class: 'pointer-events-none absolute inset-0 -z-20' });
	#color;
	/** @type {HTMLElement[]} */
	#bands = [];
	#bandClass;

	/** @param {string} colorClass the tile's background colors, with `group-*` variants for hover and playing */
	constructor(colorClass) {
		this.#bandClass = `pointer-events-none absolute inset-0 -z-10 ${colorClass}`;
		this.#color = h('span', { 'class': this.#bandClass, 'data-tile-color': true });
	}

	/** The layers, to put first inside the tile. */
	get layers() {
		return [this.#image, this.#blur, this.#color];
	}

	/**
	 * A band of the tile's color behind some content, more opaque than the tile's color so text on it stays readable
	 * over any image. The content's element needs `relative` and `isolate`.
	 * @returns {HTMLElement} the band's color, to put first inside that element
	 */
	band() {
		const band = h('span', { class: this.#bandClass });
		this.#bands.push(band);
		return band;
	}

	/**
	 * @param {string | null} url the image, or null for a plain tile
	 * @param {BackgroundStyle} style
	 */
	show(url, style) {
		const hasImage = url !== null;
		this.#image.hidden = !hasImage;
		if (hasImage && this.#image.dataset.url !== url) {
			this.#image.dataset.url = url;
			this.#image.style.backgroundImage = `url("${url.replace(/["\\]/g, '\\$&')}")`;
		}
		const opacity = hasImage ? style.imageColorOpacity : 1;
		this.#color.style.opacity = String(opacity);
		const blur = hasImage && style.imageBlur > 0 ? `blur(${style.imageBlur}px)` : '';
		this.#blur.style.backdropFilter = blur;
		for (const band of this.#bands) {
			band.style.opacity = String(Math.min(1, opacity + STATUS_BAND_EXTRA_OPACITY));
		}
	}
}

/**
 * The title's shadow, as a filter on an element around the title rather than a text shadow on it: line clamping cuts
 * whatever overflows the title's box, which would cut a text shadow at the edges too.
 * @param {HTMLElement} element
 * @param {BackgroundStyle | null} style null for a plain tile, which has none
 */
export function showTitleShadow(element, style) {
	const { titleShadowOpacity: opacity, titleShadowBlur: blur, titleShadowOffset: offset } = style ?? { titleShadowOpacity: 0, titleShadowBlur: 0, titleShadowOffset: 0 };
	element.style.filter = opacity > 0 ? `drop-shadow(${offset}px ${offset}px ${blur / 2}px rgb(0 0 0 / ${opacity}))` : '';
}
