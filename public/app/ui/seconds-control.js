import { Component } from './component.js';
import { h, on } from './dom.js';
import { formatSeconds, parseSeconds, SLIDER_STEP } from './seconds-scale.js';

/** @typedef {import('./seconds-scale.js').SecondsLimits} SecondsLimits */

/**
 * A duration in seconds for a playlist's crossfade or fades (DESIGN.md §9.7): a slider in half-second steps and a
 * readout that turns into a text field for exact values, both stopping at the given limits.
 */
export class SecondsControl extends Component {
	#value;
	#name;
	#label;
	#limits;
	#describe;
	#onChange;
	/** @type {((value: number) => void) | null} */
	#show = null;

	/**
	 * @param {object} options
	 * @param {number} options.value seconds
	 * @param {string} options.name identifies the control in the page, such as `crossfade`
	 * @param {string} options.label names the control for screen readers
	 * @param {SecondsLimits} options.limits
	 * @param {(value: number) => string | null} [options.describe] a note shown below, such as what limits the value
	 * @param {(value: number) => void} options.onChange called for every change the user makes
	 */
	constructor({ value, name, label, limits, describe = () => null, onChange }) {
		super();
		this.#value = value;
		this.#name = name;
		this.#label = label;
		this.#limits = limits;
		this.#describe = describe;
		this.#onChange = onChange;
	}

	/**
	 * Shows a value set elsewhere.
	 * @param {number} value
	 */
	update(value) {
		if (value !== this.#value) {
			this.#value = value;
			this.#show?.(value);
		}
	}

	/** @override */
	render() {
		const limits = this.#limits;
		const slider = h('input', {
			'type': 'range',
			'min': '0',
			'max': String(limits.slider),
			'step': String(SLIDER_STEP),
			'aria-label': this.#label,
			'data-seconds-slider': true,
			'class': 'w-60 shrink-0 cursor-pointer accent-music',
		});
		const readout = h('button', {
			'type': 'button',
			'class': 'w-24 shrink-0 cursor-text rounded-md px-2 py-1 text-right font-medium tabular-nums hover:bg-raised-hover',
			'title': 'Click to type a value in seconds',
			'data-seconds-readout': true,
		});
		const field = h('input', {
			'type': 'text',
			'inputmode': 'decimal',
			'hidden': true,
			'aria-label': `${this.#label} in seconds`,
			'class': 'w-24 shrink-0 rounded-md border border-line bg-surface px-2 py-1 text-right tabular-nums outline-none focus:border-music data-[invalid=true]:border-danger',
		});
		const note = h('p', { class: 'text-xs text-muted' });

		const show = (/** @type {number} */ value) => {
			slider.value = String(Math.min(value, limits.slider));
			readout.textContent = formatSeconds(value);
			const description = this.#describe(value);
			note.textContent = description ?? '';
			note.hidden = description === null;
		};
		const change = (/** @type {number} */ value) => {
			if (value !== this.#value) {
				this.#value = value;
				show(value);
				this.#onChange(value);
			}
		};
		this.#show = show;
		show(this.#value);

		this.own(on(slider, 'input', () => change(Number(slider.value))));

		/** @returns {number | null} */
		const typed = () => {
			const seconds = parseSeconds(field.value);
			return seconds === null ? null : Math.min(seconds, limits.field);
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
			field.value = this.#value > 0 ? String(this.#value) : '0';
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
				// Only this edit is cancelled; the dialog around the control stays open.
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

		return h('div', { 'class': 'space-y-1', 'data-seconds-control': this.#name },
			h('div', { class: 'flex items-center gap-2' }, slider, readout, field),
			note);
	}
}
