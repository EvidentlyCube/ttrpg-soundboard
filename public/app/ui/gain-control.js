import { Component } from './component.js';
import { h, on } from './dom.js';
import { BARS_SHARE, formatDb, ITEM_SCALE, parseDb, stepGain } from './gain-scale.js';

/** @typedef {import('./gain-scale.js').GainScale} GainScale */

const BAR_COUNT = 10;
const LOWEST_BAR_PERCENT = 20;

/**
 * A media-player style volume control (DESIGN.md §9.7): bars that grow taller up to gain 1, on scales with a boost one
 * wide rectangle above it that lights up orange, a line underneath, and a dB readout that turns into a text field when
 * clicked. The lit part is a copy of the shapes clipped with an inline style, so dragging never changes classes
 * (DESIGN.md §9.6).
 */
export class GainControl extends Component {
	#value;
	#scale;
	#label;
	#compact;
	#onChange;
	#dragging = false;
	/** @type {((value: number) => void) | null} */
	#show = null;

	/**
	 * @param {object} options
	 * @param {number} options.value in the scale's units
	 * @param {GainScale} [options.scale] defaults to an item's gain
	 * @param {string} options.label names the control for screen readers
	 * @param {boolean} [options.compact] narrower, for the header
	 * @param {(value: number) => void} options.onChange called for every change the user makes
	 */
	constructor({ value, scale = ITEM_SCALE, label, compact = false, onChange }) {
		super();
		this.#value = value;
		this.#scale = scale;
		this.#label = label;
		this.#compact = compact;
		this.#onChange = onChange;
	}

	/**
	 * Shows a value set elsewhere. Ignored while the user drags, so the control never fights the pointer.
	 * @param {number} value
	 */
	update(value) {
		if (!this.#dragging && value !== this.#value) {
			this.#value = value;
			this.#show?.(value);
		}
	}

	/** @override */
	render() {
		const scale = this.#scale;
		const lit = h('div', { class: 'absolute inset-0', style: { clipPath: 'inset(0 100% 0 0)' } },
			shapes('bg-text', 'bg-boost', scale.boost));
		const track = h('div', {
			'role': 'slider',
			'tabindex': '0',
			'aria-label': this.#label,
			'aria-valuemin': '0',
			'aria-valuemax': String(scale.max),
			'title': 'Click or drag to set the volume; double-click for 0 dB',
			'data-gain-track': true,
			'class': `relative h-8 ${this.#compact ? 'w-32' : 'w-60'} shrink-0 cursor-pointer touch-none select-none rounded-sm outline-none `
				+ 'focus-visible:ring-2 focus-visible:ring-music focus-visible:ring-offset-4 focus-visible:ring-offset-panel',
		}, h('div', { class: 'absolute inset-0' }, shapes('bg-line', 'bg-line', scale.boost)), lit);

		const width = this.#compact ? 'w-20 text-sm' : 'w-24';
		const readout = h('button', {
			'type': 'button',
			'class': `${width} shrink-0 cursor-text rounded-md px-2 py-1 text-right font-medium tabular-nums hover:bg-raised-hover data-[boost=true]:text-boost`,
			'title': 'Click to type a level in dB',
			'data-gain-readout': true,
		});
		const field = h('input', {
			'type': 'text',
			'inputmode': 'decimal',
			'hidden': true,
			'aria-label': `${this.#label} in dB`,
			'class': `${width} shrink-0 rounded-md border border-line bg-surface px-2 py-1 text-right tabular-nums outline-none focus:border-music data-[invalid=true]:border-danger`,
		});

		const show = (/** @type {number} */ value) => {
			const gain = scale.toGain(value);
			lit.style.clipPath = `inset(0 ${(1 - scale.toPosition(value)) * 100}% 0 0)`;
			readout.textContent = formatDb(gain);
			readout.dataset.boost = String(gain > 1);
			track.setAttribute('aria-valuenow', String(value));
			track.setAttribute('aria-valuetext', formatDb(gain));
		};
		const change = (/** @type {number} */ value) => {
			if (value !== this.#value) {
				this.#value = value;
				show(value);
				this.#onChange(value);
			}
		};
		const fromPointer = (/** @type {PointerEvent} */ event) => {
			const { left, width: trackWidth } = track.getBoundingClientRect();
			change(scale.fromPosition((event.clientX - left) / trackWidth));
		};
		this.#show = show;
		show(this.#value);

		this.own(on(track, 'pointerdown', (event) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			track.focus();
			track.setPointerCapture(event.pointerId);
			this.#dragging = true;
			fromPointer(event);
		}));
		this.own(on(track, 'pointermove', (event) => {
			if (this.#dragging) {
				fromPointer(event);
			}
		}));
		const endDrag = () => {
			this.#dragging = false;
		};
		this.own(on(track, 'pointerup', endDrag));
		this.own(on(track, 'pointercancel', endDrag));
		this.own(on(track, 'dblclick', () => change(scale.fromGain(1))));
		this.own(on(track, 'keydown', (event) => {
			const step = (/** @type {number} */ steps) => scale.fromGain(stepGain(scale.toGain(this.#value), steps));
			/** @type {Record<string, () => number>} */
			const keys = {
				ArrowUp: () => step(1),
				ArrowRight: () => step(1),
				ArrowDown: () => step(-1),
				ArrowLeft: () => step(-1),
				Home: () => 0,
				End: () => scale.max,
			};
			const next = keys[event.key];
			if (next) {
				event.preventDefault();
				change(next());
			}
		}));

		/** @returns {number | null} the value typed, or null when it is not a level */
		const typed = () => {
			const gain = parseDb(field.value);
			return gain === null ? null : scale.fromGain(gain);
		};
		const finishEditing = (/** @type {number | null} */ value) => {
			field.hidden = true;
			readout.hidden = false;
			if (value !== null) {
				change(value);
			}
		};
		this.own(on(readout, 'click', () => {
			readout.hidden = true;
			field.hidden = false;
			field.dataset.invalid = 'false';
			field.value = formatDb(scale.toGain(this.#value)).replace(' dB', '');
			field.focus();
			field.select();
		}));
		this.own(on(field, 'keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				const value = typed();
				if (value === null) {
					field.dataset.invalid = 'true';
					return;
				}
				finishEditing(value);
				readout.focus();
			} else if (event.key === 'Escape') {
				// Only this edit is cancelled; a dialog around the control stays open.
				event.stopPropagation();
				finishEditing(null);
				readout.focus();
			}
		}));
		this.own(on(field, 'input', () => {
			field.dataset.invalid = 'false';
		}));
		this.own(on(field, 'blur', () => {
			if (!field.hidden) {
				finishEditing(typed());
			}
		}));

		return h('div', { 'class': 'flex items-center gap-2', 'data-gain-control': true }, track, readout, field);
	}
}

/**
 * The bars, the boost rectangle and the line, in the given colors. The bars fill exactly the share of the width that
 * gain 0 to 1 takes on the scale, so a clip at a value's position lights up exactly up to that value.
 * @param {string} barClass
 * @param {string} boostClass
 * @param {boolean} boost whether the scale has a boost section
 */
function shapes(barClass, boostClass, boost) {
	const barsShare = boost ? `${BARS_SHARE * 100}%` : '100%';
	const bars = Array.from({ length: BAR_COUNT }, (_, index) => h('div', {
		class: `flex-1 rounded-[2px] ${barClass}`,
		style: { height: `${LOWEST_BAR_PERCENT + ((100 - LOWEST_BAR_PERCENT) * index) / (BAR_COUNT - 1)}%` },
	}));
	return [
		h('div', { class: `absolute top-0 bottom-2.5 left-0 flex items-end gap-[3px] ${boost ? 'pr-[3px]' : ''}`, style: { width: barsShare } }, bars),
		h('div', { class: `absolute bottom-0 left-0 h-1.5 ${boost ? 'rounded-l-full' : 'rounded-full'} ${barClass}`, style: { width: barsShare } }),
		boost && h('div', { class: `absolute top-0 right-0 bottom-2.5 rounded-[2px] ${boostClass}`, style: { left: barsShare } }),
		boost && h('div', { class: `absolute right-0 bottom-0 h-1.5 rounded-r-full ${boostClass}`, style: { left: barsShare } }),
	];
}
