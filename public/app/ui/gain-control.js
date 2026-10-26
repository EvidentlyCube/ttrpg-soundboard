import { MAX_GAIN } from '../logic/volume.js';
import { Component } from './component.js';
import { h, on } from './dom.js';
import { BARS_SHARE, formatDb, gainToPosition, parseDb, positionToGain, stepGain } from './gain-scale.js';

const BAR_COUNT = 10;
const LOWEST_BAR_PERCENT = 20;

/**
 * A media-player style volume control for one item's gain (ROADMAP.md, feature 1): bars that grow taller from gain 0
 * to 1, one wide rectangle for the boost above 1 that lights up yellow, a line underneath, and a dB readout that turns
 * into a text field when clicked. The lit part is a copy of the shapes clipped with an inline style, so dragging never
 * changes classes (DESIGN.md §9.6).
 */
export class GainControl extends Component {
	#gain;
	#label;
	#onChange;
	#dragging = false;
	/** @type {((gain: number) => void) | null} */
	#show = null;

	/**
	 * @param {object} options
	 * @param {number} options.gain
	 * @param {string} options.label names the control for screen readers
	 * @param {(gain: number) => void} options.onChange called for every change the user makes
	 */
	constructor({ gain, label, onChange }) {
		super();
		this.#gain = gain;
		this.#label = label;
		this.#onChange = onChange;
	}

	/**
	 * Shows a gain set elsewhere. Ignored while the user drags, so the control never fights the pointer.
	 * @param {number} gain
	 */
	update(gain) {
		if (!this.#dragging && gain !== this.#gain) {
			this.#gain = gain;
			this.#show?.(gain);
		}
	}

	/** @override */
	render() {
		const lit = h('div', { class: 'absolute inset-0', style: { clipPath: 'inset(0 100% 0 0)' } },
			shapes('bg-text', 'bg-boost'));
		const track = h('div', {
			'role': 'slider',
			'tabindex': '0',
			'aria-label': this.#label,
			'aria-valuemin': '0',
			'aria-valuemax': String(MAX_GAIN),
			'title': 'Click or drag to set the volume; double-click for 0 dB',
			'data-gain-track': true,
			'class': 'relative h-12 w-60 shrink-0 cursor-pointer touch-none select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-music focus-visible:ring-offset-4 focus-visible:ring-offset-panel',
		}, h('div', { class: 'absolute inset-0' }, shapes('bg-line', 'bg-line')), lit);

		const readout = h('button', {
			'type': 'button',
			'class': 'w-24 shrink-0 cursor-text rounded-md px-2 py-1 text-right font-medium tabular-nums hover:bg-raised-hover',
			'title': 'Click to type a level in dB',
			'data-gain-readout': true,
		});
		const field = h('input', {
			'type': 'text',
			'inputmode': 'decimal',
			'hidden': true,
			'aria-label': `${this.#label} in dB`,
			'class': 'w-24 shrink-0 rounded-md border border-line bg-surface px-2 py-1 text-right tabular-nums outline-none focus:border-music data-[invalid=true]:border-danger',
		});

		const show = (/** @type {number} */ gain) => {
			const position = gainToPosition(gain);
			lit.style.clipPath = `inset(0 ${(1 - position) * 100}% 0 0)`;
			readout.textContent = formatDb(gain);
			track.setAttribute('aria-valuenow', String(gain));
			track.setAttribute('aria-valuetext', formatDb(gain));
		};
		const change = (/** @type {number} */ gain) => {
			if (gain !== this.#gain) {
				this.#gain = gain;
				show(gain);
				this.#onChange(gain);
			}
		};
		const fromPointer = (/** @type {PointerEvent} */ event) => {
			const { left, width } = track.getBoundingClientRect();
			change(positionToGain((event.clientX - left) / width));
		};
		this.#show = show;
		show(this.#gain);

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
		this.own(on(track, 'dblclick', () => change(1)));
		this.own(on(track, 'keydown', (event) => {
			/** @type {Record<string, () => number>} */
			const keys = {
				ArrowUp: () => stepGain(this.#gain, 1),
				ArrowRight: () => stepGain(this.#gain, 1),
				ArrowDown: () => stepGain(this.#gain, -1),
				ArrowLeft: () => stepGain(this.#gain, -1),
				Home: () => 0,
				End: () => MAX_GAIN,
			};
			const next = keys[event.key];
			if (next) {
				event.preventDefault();
				change(next());
			}
		}));

		const stopEditing = (/** @type {boolean} */ apply) => {
			if (field.hidden) {
				return;
			}
			const gain = apply ? parseDb(field.value) : null;
			if (apply && gain === null) {
				field.dataset.invalid = 'true';
				field.focus();
				return;
			}
			field.hidden = true;
			readout.hidden = false;
			if (gain !== null) {
				change(gain);
			}
			readout.focus();
		};
		this.own(on(readout, 'click', () => {
			readout.hidden = true;
			field.hidden = false;
			field.dataset.invalid = 'false';
			field.value = formatDb(this.#gain).replace(' dB', '');
			field.focus();
			field.select();
		}));
		this.own(on(field, 'keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				stopEditing(true);
			} else if (event.key === 'Escape') {
				// Only this edit is cancelled; the dialog around the control stays open.
				event.stopPropagation();
				stopEditing(false);
			}
		}));
		this.own(on(field, 'input', () => {
			field.dataset.invalid = 'false';
		}));
		this.own(on(field, 'blur', () => {
			if (!field.hidden) {
				const gain = parseDb(field.value);
				field.hidden = true;
				readout.hidden = false;
				if (gain !== null) {
					change(gain);
				}
			}
		}));

		return h('div', { 'class': 'flex items-center gap-3', 'data-gain-control': true }, track, readout, field);
	}
}

/**
 * The bars, the boost rectangle and the line, in the given colors. The bars fill exactly the share of the width that
 * gain 0 to 1 takes on the scale, so a clip at a gain's position lights up exactly up to that gain.
 * @param {string} barClass
 * @param {string} boostClass
 */
function shapes(barClass, boostClass) {
	const bars = Array.from({ length: BAR_COUNT }, (_, index) => h('div', {
		class: `flex-1 rounded-[2px] ${barClass}`,
		style: { height: `${LOWEST_BAR_PERCENT + ((100 - LOWEST_BAR_PERCENT) * index) / (BAR_COUNT - 1)}%` },
	}));
	const barsShare = `${BARS_SHARE * 100}%`;
	return [
		h('div', { class: 'absolute top-0 bottom-3 left-0 flex items-end gap-[3px] pr-[3px]', style: { width: barsShare } }, bars),
		h('div', { class: `absolute top-0 right-0 bottom-3 rounded-[2px] ${boostClass}`, style: { left: barsShare } }),
		h('div', { class: `absolute bottom-0 left-0 h-1.5 rounded-l-full ${barClass}`, style: { width: barsShare } }),
		h('div', { class: `absolute right-0 bottom-0 h-1.5 rounded-r-full ${boostClass}`, style: { left: barsShare } }),
	];
}
