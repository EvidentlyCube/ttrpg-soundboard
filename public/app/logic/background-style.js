/**
 * How a tile's color and title sit over its image (DESIGN.md §2.3). Opacities are shares from 0 to 1, the rest pixels.
 * @typedef {{ imageColorOpacity: number, imageBlur: number, titleShadowOpacity: number, titleShadowBlur: number,
 * 	titleShadowOffset: number }} BackgroundStyle
 */

/** The largest value of each setting; each goes down to 0. The server has the same limits. */
export const BACKGROUND_STYLE_LIMITS = /** @type {const} */ ({
	imageColorOpacity: 1,
	imageBlur: 20,
	titleShadowOpacity: 1,
	titleShadowBlur: 10,
	titleShadowOffset: 5,
});

/** @type {(keyof BackgroundStyle)[]} */
export const BACKGROUND_STYLE_KEYS = /** @type {(keyof BackgroundStyle)[]} */ (Object.keys(BACKGROUND_STYLE_LIMITS));

/**
 * Just the background settings of an item that has more.
 * @param {BackgroundStyle} item
 * @returns {BackgroundStyle}
 */
export function backgroundStyleOf({ imageColorOpacity, imageBlur, titleShadowOpacity, titleShadowBlur, titleShadowOffset }) {
	return { imageColorOpacity, imageBlur, titleShadowOpacity, titleShadowBlur, titleShadowOffset };
}

/** The status band is this much more opaque than the tile's color, so the status stays readable over any image. */
export const STATUS_BAND_EXTRA_OPACITY = 0.5;

/** Above this the image is accepted with a warning (DESIGN.md §5.1): 1920 px on the longer side, 1080 on the shorter. */
const FULL_HD = { long: 1920, short: 1080 };

/** @param {{ width: number, height: number }} size */
export function isLargerThanFullHd({ width, height }) {
	return Math.max(width, height) > FULL_HD.long || Math.min(width, height) > FULL_HD.short;
}
