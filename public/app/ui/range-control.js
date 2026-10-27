import { MIN_CLIP_MS } from '../logic/clip.js';
import { Component } from './component.js';
import { h, on } from './dom.js';
import { clampEnd, clampStart, formatMs, msAt, nearerHandle, parseMs, shareOf, stepFor } from './range-scale.js';

/** @typedef {import('./range-scale.js').Handle} Handle */

const FIELD_CLASS = 'w-24 rounded-md border border-line bg-surface px-2 py-1 text-right tabular-nums outline-none '
	+ 'focus:border-sfx data-[invalid=true]:border-danger';

/**
 * Chooses the part of a sound that plays (DESIGN.md §9.7): a slider with a start and an end handle that never cross,
 * two fields in milliseconds, the length that plays, and a Reset button. Positions are set with inline styles, so
 * dragging never changes classes (DESIGN.md §9.6).
 */
export class RangeControl extends Component {
	#startMs;
	#endMs;
	#durationMs;
	#onChange;
	/** @type {Handle | null} */
	#dragging = null;
	/** @type {(() => void) | null} */
	#show = null;

	/**
	 * @param {object} options
	 * @param {number} options.startMs
	 * @param {number} options.endMs
	 * @param {number} options.durationMs the length of the file
	 * @param {(startMs: number, endMs: number) => void} options.onChange called for every change the user makes
	 */
	constructor({ startMs, endMs, durationMs, onChange }) {
		super();
		this.#startMs = startMs;
		this.#endMs = endMs;
		this.#durationMs = durationMs;
		this.#onChange = onChange;
	}

	/**
	 * Shows points set elsewhere. Ignored while the user drags, so the control never fights the pointer.
	 * @param {{ startMs: number, endMs: number }} points
	 */
	update({ startMs, endMs }) {
		if (!this.#dragging && (startMs !== this.#startMs || endMs !== this.#endMs)) {
			this.#startMs = startMs;
			this.#endMs = endMs;
			this.#show?.();
		}
	}

	/** @override */
	render() {
		const durationMs = this.#durationMs;
		const lit = h('div', { class: 'absolute inset-y-0 rounded-full bg-sfx', style: { left: '0%', width: '100%' } });
		/**
		 * @param {Handle} which
		 * @param {string} label
		 */
		const handle = (which, label) => h('div', {
			'role': 'slider',
			'tabindex': '0',
			'aria-label': label,
			'aria-valuemin': '0',
			'aria-valuemax': String(durationMs),
			'data-range-handle': which,
			'class': 'absolute top-0 h-8 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-text shadow outline-none '
				+ 'focus-visible:ring-2 focus-visible:ring-sfx focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
			'style': { left: '0%' },
		});
		const handles = { start: handle('start', 'Start point'), end: handle('end', 'End point') };
		const track = h('div', {
			'class': 'relative mx-1.5 h-8 cursor-pointer touch-none select-none',
			'title': 'Drag the handles to choose the part that plays',
			'data-range-track': true,
		}, h('div', { class: 'absolute inset-x-0 top-3 h-2 rounded-full bg-line' }, lit), handles.start, handles.end);

		/**
		 * @param {Handle} which
		 * @param {string} label
		 */
		const field = (which, label) => h('input', {
			'type': 'text',
			'inputmode': 'numeric',
			'aria-label': `${label} in milliseconds`,
			'data-range-field': which,
			'class': FIELD_CLASS,
		});
		const fields = { start: field('start', 'Start point'), end: field('end', 'End point') };
		const length = h('span', { 'class': 'ml-auto text-muted tabular-nums', 'data-range-length': true });
		const reset = h('button', {
			'type': 'button',
			'class': 'cursor-pointer rounded-md px-2 py-1 text-sm text-muted hover:bg-raised-hover hover:text-text',
			'data-range-reset': true,
		}, 'Reset');

		const show = () => {
			const points = { start: this.#startMs, end: this.#endMs };
			for (const which of /** @type {Handle[]} */ (['start', 'end'])) {
				handles[which].style.left = `${shareOf(points[which], durationMs) * 100}%`;
				handles[which].setAttribute('aria-valuenow', String(points[which]));
				handles[which].setAttribute('aria-valuetext', formatMs(points[which]));
				// A field being typed in keeps what the user typed.
				if (document.activeElement !== fields[which]) {
					fields[which].value = String(points[which]);
				}
			}
			const startShare = shareOf(points.start, durationMs);
			lit.style.left = `${startShare * 100}%`;
			lit.style.width = `${(shareOf(points.end, durationMs) - startShare) * 100}%`;
			length.textContent = `Plays ${formatMs(points.end - points.start)} of ${formatMs(durationMs)}`;
		};
		/**
		 * @param {number} startMs
		 * @param {number} endMs
		 */
		const change = (startMs, endMs) => {
			if (startMs !== this.#startMs || endMs !== this.#endMs) {
				this.#startMs = startMs;
				this.#endMs = endMs;
				show();
				this.#onChange(startMs, endMs);
			}
		};
		/**
		 * @param {Handle} which
		 * @param {number} ms
		 */
		const move = (which, ms) => {
			if (which === 'start') {
				change(clampStart(ms, this.#endMs), this.#endMs);
			} else {
				change(this.#startMs, clampEnd(ms, this.#startMs, durationMs));
			}
		};
		const msAtPointer = (/** @type {PointerEvent} */ event) => {
			const { left, width } = track.getBoundingClientRect();
			return msAt((event.clientX - left) / width, durationMs);
		};
		this.#show = show;
		show();

		this.own(on(track, 'pointerdown', (event) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			const ms = msAtPointer(event);
			const pressed = /** @type {HTMLElement} */ (event.target).dataset.rangeHandle;
			const which = pressed === 'start' || pressed === 'end' ? pressed : nearerHandle(ms, this.#startMs, this.#endMs);
			handles[which].focus();
			track.setPointerCapture(event.pointerId);
			this.#dragging = which;
			move(which, ms);
		}));
		this.own(on(track, 'pointermove', (event) => {
			if (this.#dragging) {
				move(this.#dragging, msAtPointer(event));
			}
		}));
		const endDrag = () => {
			this.#dragging = null;
		};
		this.own(on(track, 'pointerup', endDrag));
		this.own(on(track, 'pointercancel', endDrag));

		for (const which of /** @type {Handle[]} */ (['start', 'end'])) {
			this.own(on(handles[which], 'keydown', (event) => {
				const current = which === 'start' ? this.#startMs : this.#endMs;
				const step = stepFor(event.key, event.shiftKey);
				/** @type {Record<string, number>} */
				const limits = which === 'start'
					? { Home: 0, End: this.#endMs - MIN_CLIP_MS }
					: { Home: this.#startMs + MIN_CLIP_MS, End: durationMs };
				const target = step === null ? limits[event.key] : current + step;
				if (target !== undefined) {
					event.preventDefault();
					move(which, target);
				}
			}));

			const input = fields[which];
			/** Applies the typed value; returns false when it can't be read. */
			const apply = () => {
				const ms = parseMs(input.value);
				if (ms === null) {
					return false;
				}
				move(which, ms);
				input.value = String(which === 'start' ? this.#startMs : this.#endMs);
				return true;
			};
			this.own(on(input, 'keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					input.dataset.invalid = String(!apply());
				} else if (event.key === 'Escape') {
					// Only this edit is cancelled; the dialog around the control stays open. Restoring the value first means
					// leaving the field has nothing to apply.
					event.stopPropagation();
					input.value = String(which === 'start' ? this.#startMs : this.#endMs);
					input.dataset.invalid = 'false';
					input.blur();
				}
			}));
			this.own(on(input, 'input', () => {
				input.dataset.invalid = 'false';
			}));
			this.own(on(input, 'blur', () => {
				// Unreadable text is dropped; the field goes back to the current point.
				apply();
				input.dataset.invalid = 'false';
				show();
			}));
		}
		this.own(on(reset, 'click', () => change(0, durationMs)));

		return h('div', { 'class': 'space-y-2', 'data-range-control': true },
			track,
			h('div', { class: 'flex flex-wrap items-center gap-x-4 gap-y-2 text-sm' },
				h('label', { class: 'flex items-center gap-2' }, 'Start', fields.start, h('span', { class: 'text-muted' }, 'ms')),
				h('label', { class: 'flex items-center gap-2' }, 'End', fields.end, h('span', { class: 'text-muted' }, 'ms')),
				length,
				reset));
	}
}
