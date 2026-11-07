import { BACKGROUND_STYLE_LIMITS, isLargerThanFullHd } from '../logic/background-style.js';
import { Component } from './component.js';
import { card, labeledRow } from './customize-parts.js';
import { h, on } from './dom.js';
import { icon } from './icons.js';
import { describeError, t } from './text.js';

/** @typedef {import('../logic/background-style.js').BackgroundStyle} BackgroundStyle */
/** @typedef {import('../logic/ports.js').BackgroundJson} BackgroundJson */
/** @typedef {{ background: BackgroundJson | null } & BackgroundStyle} ItemWithBackground */

/** What the file picker offers; the server checks the file's bytes whatever it is called. */
const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.avif,image/jpeg,image/png,image/gif,image/webp,image/avif';

/** Colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const ACCENTS = {
	music: { slider: 'accent-music', focus: 'focus-within:border-music' },
	sfx: { slider: 'accent-sfx', focus: 'focus-within:border-sfx' },
};

/** The buttons joined to the link field, as segments of one widget. */
const SEGMENT_BASE = 'grid w-10 shrink-0 cursor-pointer place-items-center border-l border-line disabled:cursor-not-allowed disabled:opacity-40';
const SEGMENT = `${SEGMENT_BASE} text-muted enabled:hover:bg-raised-hover enabled:hover:text-text`;
const DANGER_SEGMENT = `${SEGMENT_BASE} text-danger enabled:hover:bg-danger/15`;

/**
 * @typedef {object} SliderSpec
 * @property {keyof BackgroundStyle} key
 * @property {string} label
 * @property {'percent' | 'px'} unit opacities are shares shown as percentages
 * @property {number} step
 */

/**
 * The Image tab of a Customize dialog (DESIGN.md §9.7): a preview tile, the image's source, and the sliders for how
 * the tile's color and title sit over it. Built for any item with a tile; the dialog hands in the preview and the calls.
 */
export class BackgroundEditor extends Component {
	#item;
	#preview;
	#accent;
	#onStyle;
	#onUpload;
	#onDownload;
	#onRemove;
	/** @type {((item: ItemWithBackground) => void) | null} */
	#show = null;

	/**
	 * @param {object} options
	 * @param {ItemWithBackground} options.item
	 * @param {HTMLElement} options.preview a tile that follows the item, as the board shows it
	 * @param {keyof typeof ACCENTS} options.accent
	 * @param {(changes: Partial<BackgroundStyle>) => void} options.onStyle
	 * @param {(file: File) => Promise<void>} options.onUpload rejects with a message for the user
	 * @param {(url: string) => Promise<void>} options.onDownload rejects with a message for the user
	 * @param {() => Promise<void>} options.onRemove rejects with a message for the user
	 */
	constructor({ item, preview, accent, onStyle, onUpload, onDownload, onRemove }) {
		super();
		this.#item = item;
		this.#preview = preview;
		this.#accent = accent;
		this.#onStyle = onStyle;
		this.#onUpload = onUpload;
		this.#onDownload = onDownload;
		this.#onRemove = onRemove;
	}

	/**
	 * Shows the item as it is now, after a change made here or elsewhere.
	 * @param {ItemWithBackground} item
	 */
	update(item) {
		this.#item = item;
		this.#show?.(item);
	}

	/** @override */
	render() {
		const accent = ACCENTS[this.#accent];
		const link = h('input', {
			'type': 'url',
			'class': 'min-w-0 flex-1 bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted',
			'placeholder': t('customize.image.linkPlaceholder'),
			'aria-label': t('customize.image.link'),
			'data-background-link': true,
		});
		const download = h('button', {
			'type': 'button',
			'class': SEGMENT,
			'title': t('customize.image.download'),
			'aria-label': t('customize.image.download'),
			'data-background-download': true,
		}, icon('cloud-arrow-down', 'size-4'));
		const file = h('input', { 'type': 'file', 'accept': ACCEPT, 'hidden': true, 'data-background-file': true });
		const choose = h('button', {
			'type': 'button',
			'class': SEGMENT,
			'title': t('customize.image.choose'),
			'aria-label': t('customize.image.choose'),
			'data-background-choose': true,
		}, icon('file-arrow-up', 'size-4'));
		const remove = h('button', {
			'type': 'button',
			'class': DANGER_SEGMENT,
			'title': t('customize.image.remove'),
			'aria-label': t('customize.image.remove'),
			'data-background-remove': true,
		}, icon('trash-can', 'size-4'));
		const source = h('div', {
			class: `flex h-10 items-stretch overflow-hidden rounded-md border border-line ${accent.focus}`,
		}, link, download, choose, remove, file);

		// Laid over the preview, so showing it does not push the rest of the tab down.
		const busy = h('div', {
			'class': 'pointer-events-none absolute inset-0 grid place-items-center',
			'hidden': true,
			'role': 'status',
			'aria-label': t('customize.image.working'),
		}, h('span', { class: 'grid size-10 place-items-center rounded-full bg-black/60 text-white' },
			icon('circle-notch', 'size-5 animate-spin')));
		const error = h('p', { 'class': 'text-sm text-danger', 'hidden': true, 'data-background-error': true });
		const large = h('p', {
			'class': 'flex items-start gap-2 text-sm text-notice',
			'hidden': true,
			'data-background-large': true,
		});
		const hint = h('p', { class: 'text-xs text-muted' }, t('customize.image.hint'));

		/** @type {Map<keyof BackgroundStyle, { input: HTMLInputElement, readout: HTMLElement, unit: SliderSpec['unit'] }>} */
		const sliders = new Map();
		/** @param {SliderSpec} spec */
		const slider = ({ key, label, unit, step }) => {
			const input = h('input', {
				'type': 'range',
				'min': '0',
				'max': String(BACKGROUND_STYLE_LIMITS[key]),
				'step': String(step),
				'aria-label': label,
				'data-background-slider': key,
				'class': `w-56 shrink-0 cursor-pointer disabled:cursor-not-allowed ${accent.slider}`,
			});
			const readout = h('span', { class: 'w-16 shrink-0 text-right text-sm font-medium tabular-nums' });
			this.own(on(input, 'input', () => {
				const value = Number(input.value);
				readout.textContent = formatValue(value, unit);
				this.#onStyle({ [key]: value });
			}));
			sliders.set(key, { input, readout, unit });
			// The whole row dims while the slider is off, so it reads as unusable rather than as set to zero.
			return h('div', { class: 'has-disabled:opacity-40' },
				labeledRow(label, h('div', { class: 'flex items-center gap-3' }, input, readout)));
		};
		const colorCard = card(t('customize.image.colorCard'), this.#accent, h('div', { class: 'space-y-3' },
			slider({ key: 'imageColorOpacity', label: t('customize.image.opacity'), unit: 'percent', step: 0.01 }),
			slider({ key: 'imageBlur', label: t('customize.image.blur'), unit: 'px', step: 0.5 })));
		const shadowCard = card(t('customize.image.shadowCard'), this.#accent, h('div', { class: 'space-y-3' },
			slider({ key: 'titleShadowOpacity', label: t('customize.image.opacity'), unit: 'percent', step: 0.01 }),
			slider({ key: 'titleShadowBlur', label: t('customize.image.blur'), unit: 'px', step: 0.5 }),
			slider({ key: 'titleShadowOffset', label: t('customize.image.offset'), unit: 'px', step: 0.5 })));

		let working = false;
		const show = (/** @type {ItemWithBackground} */ item) => {
			const hasImage = item.background !== null;
			for (const [key, { input, readout, unit }] of sliders) {
				// Setting a slider's value while it is dragged would make it jump; it already shows the value.
				if (Number(input.value) !== item[key]) {
					input.value = String(item[key]);
				}
				readout.textContent = formatValue(item[key], unit);
				input.disabled = !hasImage;
			}
			for (const sliderCard of [colorCard, shadowCard]) {
				sliderCard.toggleAttribute('data-disabled', !hasImage);
			}
			remove.disabled = working || !hasImage;
			const tooLarge = item.background !== null && isLargerThanFullHd(item.background);
			large.hidden = !tooLarge;
			if (item.background && tooLarge) {
				large.replaceChildren(
					icon('triangle-exclamation', 'mt-0.5 size-4 shrink-0'),
					t('customize.image.large', { width: item.background.width, height: item.background.height }),
				);
			}
		};
		this.#show = show;
		show(this.#item);

		/** @param {() => Promise<void>} request */
		const run = async (request) => {
			if (working) {
				return;
			}
			working = true;
			for (const control of [link, download, choose, remove]) {
				control.disabled = true;
			}
			busy.hidden = false;
			error.hidden = true;
			try {
				await request();
				link.value = '';
			} catch (failure) {
				error.textContent = t('customize.image.failed', { reason: describeError(failure) });
				error.hidden = false;
			} finally {
				working = false;
				for (const control of [link, download, choose]) {
					control.disabled = false;
				}
				busy.hidden = true;
				show(this.#item);
			}
		};
		const startDownload = () => {
			const url = link.value.trim();
			if (url !== '') {
				run(() => this.#onDownload(url));
			}
		};
		this.own(on(download, 'click', startDownload));
		this.own(on(link, 'keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				startDownload();
			}
		}));
		this.own(on(choose, 'click', () => file.click()));
		this.own(on(file, 'change', () => {
			const chosen = file.files?.[0];
			file.value = '';
			if (chosen) {
				run(() => this.#onUpload(chosen));
			}
		}));
		this.own(on(remove, 'click', () => run(() => this.#onRemove())));

		// The cards' title pills stick out above them, so they need the extra space.
		return h('div', { class: 'space-y-8 pt-3' },
			card(t('customize.image.card'), this.#accent, h('div', { class: 'space-y-3' },
				h('div', { class: 'relative mx-auto w-56' }, this.#preview, busy),
				source, hint, error, large)),
			h('div', { class: 'space-y-8' }, colorCard, shadowCard));
	}
}

/**
 * @param {number} value
 * @param {SliderSpec['unit']} unit
 */
function formatValue(value, unit) {
	return unit === 'percent' ? `${Math.round(value * 100)} %` : `${value.toFixed(1)} px`;
}
