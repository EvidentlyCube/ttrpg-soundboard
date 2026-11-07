/**
 * The Font Awesome Free icons the app uses (DESIGN.md §9.6), each a file in `public/vendor/fontawesome/svgs-full/<style>/`.
 * A list rather than any string, so a misspelled name fails the type check instead of drawing an empty box.
 */
export const ICON_NAMES = /** @type {const} */ ([
	'play',
	'pause',
	'stop',
	'backward-step',
	'forward-step',
	'volume-high',
	'bug',
	'chevron-down',
	'circle-notch',
	'bars',
	'trash-can',
	'triangle-exclamation',
	'check',
	'tower-broadcast',
	'link-slash',
	'mobile-screen',
	'gear',
	'circle-info',
	'scale-balanced',
	'folder-open',
	'language',
	'bolt',
	'rotate-left',
	'sliders',
	'file-lines',
	'cloud-arrow-down',
	'file-arrow-up',
]);

/** @typedef {typeof ICON_NAMES[number]} IconName */
