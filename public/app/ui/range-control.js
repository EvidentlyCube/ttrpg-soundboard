import { MIN_CLIP_MS } from '../logic/clip.js';
import { Component } from './component.js';
import { h, on } from './dom.js';
import { filledField } from './filled-field.js';
import { paintWaveform } from './waveform-canvas.js';
import { clampEnd, clampStart, fadeBands, formatTime, msAt, nearerHandle, parseTime, shareOf, stepFor, toFieldText } from './range-scale.js';

/** @typedef {import('./range-scale.js').Handle} Handle */

/**
 * Complete class names per accent, because the browser build only generates classes it sees written out (DESIGN.md §9.6).
 * @type {Record<'sfx' | 'music', { lit: string, ring: string, reset: string, wave: string }>}
 */
const ACCENTS = {
	sfx: {
		lit: 'bg-sfx',
		ring: 'focus-visible:ring-sfx',
		reset: 'hover:border-sfx focus-visible:border-sfx',
		wave: 'text-sfx',
	},
	music: {
		lit: 'bg-music',
		ring: 'focus-visible:ring-music',
		reset: 'hover:border-music focus-visible:border-music',
		wave: 'text-music',
	},
};

/**
 * Where a playing track is, for the control's seek mode.
 * @typedef {object} Playback
 * @property {number} positionMs from the start point
 * @property {number | null} crossfadeFromMs from the start point; null when no crossfade is coming
 */

/**
 * Chooses the part of a sound or track that plays (DESIGN.md §9.7): a slider with a start and an end handle that never
 * cross, two fields in seconds, the length that plays, and a Reset button. Positions are set with inline styles, so
 * dragging never changes classes (DESIGN.md §9.6).
 *
 * `showPlayback` turns it into a seek bar for a track that is playing: the handles are hidden, the fields and Reset
 * are disabled, and pressing the part that plays calls `onSeek`.
 */
export class RangeControl extends Component {
	#startMs;
	#endMs;
	#durationMs;
	#fadeInMs;
	#fadeOutMs;
	#accent;
	#onChange;
	#onSeek;
	/** @type {Handle | null} */
	#dragging = null;
	/** @type {(() => void) | null} */
	#show = null;
	/** @type {Playback | null} */
	#playback = null;
	/** @type {((playing: boolean) => void) | null} */
	#showMode = null;
	/** @type {(() => void) | null} */
	#showPosition = null;
	/** @type {Int8Array | null} */
	#peaks = null;
	/** @type {(() => void) | null} */
	#drawWaveform = null;

	/**
	 * @param {object} options
	 * @param {number} options.startMs
	 * @param {number} options.endMs
	 * @param {number} options.durationMs the length of the file
	 * @param {number} [options.fadeInMs] shown on the part that plays
	 * @param {number} [options.fadeOutMs]
	 * @param {'sfx' | 'music'} [options.accent]
	 * @param {(startMs: number, endMs: number) => void} options.onChange called for every change the user makes
	 * @param {(seconds: number) => void} [options.onSeek] called when the part that plays is pressed in seek mode, with
	 * 	the position in seconds from the start point
	 */
	constructor({ startMs, endMs, durationMs, fadeInMs = 0, fadeOutMs = 0, accent = 'sfx', onChange, onSeek = () => {} }) {
		super();
		this.#startMs = startMs;
		this.#endMs = endMs;
		this.#durationMs = durationMs;
		this.#fadeInMs = fadeInMs;
		this.#fadeOutMs = fadeOutMs;
		this.#accent = accent;
		this.#onChange = onChange;
		this.#onSeek = onSeek;
	}

	/**
	 * Switches between the editor (null) and the seek bar of a playing track, and moves the playhead.
	 * @param {Playback | null} playback
	 */
	showPlayback(playback) {
		const wasPlaying = this.#playback !== null;
		this.#playback = playback;
		if (wasPlaying !== (playback !== null)) {
			this.#showMode?.(playback !== null);
		}
		this.#showPosition?.();
	}

	/**
	 * Shows the file's waveform above the slider, or nothing for null. Min/max byte pairs, as the soundboard stores them.
	 * @param {Int8Array | null} peaks
	 */
	showWaveform(peaks) {
		this.#peaks = peaks;
		this.#drawWaveform?.();
	}

	/**
	 * Shows changed fades on the part that plays.
	 * @param {number} fadeInMs
	 * @param {number} fadeOutMs
	 */
	showFades(fadeInMs, fadeOutMs) {
		if (fadeInMs !== this.#fadeInMs || fadeOutMs !== this.#fadeOutMs) {
			this.#fadeInMs = fadeInMs;
			this.#fadeOutMs = fadeOutMs;
			this.#show?.();
		}
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
		// The fades are drawn inside the part that plays, in shares of its length. Where they overlap, or when one is longer
		// than the whole part, they can't play out fully, which is shown pulsing between two reds.
		const band = (/** @type {string} */ color) => h('div', { class: `absolute inset-y-0 ${color}`, style: { left: '0%', width: '0%' } });
		const bands = {
			fadeIn: band('bg-music'),
			fadeOut: band('bg-music'),
			overlap: band('bg-danger animate-warn'),
			tooLong: band('bg-danger animate-warn'),
		};
		const colors = ACCENTS[this.#accent];
		// Seek mode: what has not played yet is dimmed, and the stretch a crossfade will take over is lightened, as in the
		// footer's progress bar (DESIGN.md §9.2).
		const unplayed = h('div', { class: 'absolute inset-y-0 right-0 bg-black/45', style: { width: '0%' }, hidden: true });
		const crossfade = h('div', {
			class: 'absolute inset-y-0 right-0 bg-white/30',
			title: 'Crossfade into the next track',
			style: { width: '0%' },
			hidden: true,
		});
		const lit = h('div', { class: `absolute inset-y-0 overflow-hidden rounded-full ${colors.lit}`, style: { left: '0%', width: '100%' } },
			bands.fadeIn, bands.fadeOut, bands.overlap, bands.tooLong, unplayed, crossfade);
		/**
		 * @param {HTMLElement} element
		 * @param {number} from share of the part that plays
		 * @param {number} share
		 */
		const place = (element, from, share) => {
			element.style.left = `${from * 100}%`;
			element.style.width = `${share * 100}%`;
		};
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
				+ `focus-visible:ring-2 ${colors.ring} focus-visible:ring-offset-2 focus-visible:ring-offset-raised`,
			'style': { left: '0%' },
		});
		const handles = { start: handle('start', 'Start point'), end: handle('end', 'End point') };
		// The waveform has the slider's width and margins, so a handle stands over the sound it cuts at. Outside the handles
		// it is dimmed by two plain shades, which move with inline styles like the handles do.
		const wave = h('canvas', { class: `block h-14 w-full ${colors.wave}` });
		const shadeBefore = h('div', { class: 'absolute inset-y-0 left-0 bg-raised/70', style: { width: '0%' } });
		const shadeAfter = h('div', { class: 'absolute inset-y-0 right-0 bg-raised/70', style: { width: '0%' } });
		const waveBox = h('div', { 'class': 'relative mx-1.5', 'data-range-waveform': true, 'hidden': true }, wave, shadeBefore, shadeAfter);
		const track = h('div', {
			'class': 'relative mx-1.5 h-8 cursor-pointer touch-none select-none',
			'title': 'Drag the handles to choose the part that plays',
			'data-range-track': true,
		}, h('div', { class: 'absolute inset-x-0 top-3 h-2 rounded-full bg-line' }, lit), handles.start, handles.end);

		/**
		 * @param {Handle} which
		 * @param {string} label
		 */
		const field = (which, label) => filledField({
			label,
			unit: 's',
			accent: this.#accent,
			attributes: { 'inputmode': 'decimal', 'aria-label': `${label} point in seconds`, 'data-range-field': which },
		});
		const startField = field('start', 'Start');
		const endField = field('end', 'End');
		const fields = { start: startField.input, end: endField.input };
		const length = h('p', { 'class': 'text-center text-xs text-muted tabular-nums', 'data-range-length': true });
		// Solid and outlined in the bar's color, so it sits on the bar like a knot in it.
		const reset = h('button', {
			'type': 'button',
			'class': 'cursor-pointer rounded-full border-2 border-line bg-surface px-3 py-0.5 text-xs text-muted transition-colors '
				+ `${colors.reset} hover:text-text focus-visible:text-text focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50`,
			'data-range-reset': true,
		}, 'Reset');

		const show = () => {
			const points = { start: this.#startMs, end: this.#endMs };
			for (const which of /** @type {Handle[]} */ (['start', 'end'])) {
				handles[which].style.left = `${shareOf(points[which], durationMs) * 100}%`;
				handles[which].setAttribute('aria-valuenow', String(points[which]));
				handles[which].setAttribute('aria-valuetext', formatTime(points[which]));
				// A field being typed in keeps what the user typed.
				if (document.activeElement !== fields[which]) {
					fields[which].value = toFieldText(points[which]);
				}
			}
			const startShare = shareOf(points.start, durationMs);
			lit.style.left = `${startShare * 100}%`;
			lit.style.width = `${(shareOf(points.end, durationMs) - startShare) * 100}%`;
			const fades = fadeBands(points.end - points.start, this.#fadeInMs, this.#fadeOutMs);
			place(bands.fadeIn, 0, fades.fadeIn);
			place(bands.fadeOut, 1 - fades.fadeOut, fades.fadeOut);
			place(bands.overlap, fades.overlap?.from ?? 0, fades.overlap?.share ?? 0);
			place(bands.tooLong, 0, fades.tooLong ? 1 : 0);
			shadeBefore.style.width = `${startShare * 100}%`;
			shadeAfter.style.width = `${(1 - shareOf(points.end, durationMs)) * 100}%`;
			length.textContent = `Plays ${formatTime(points.end - points.start)} of ${formatTime(durationMs)}`;
			this.#showPosition?.();
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

		const drawWave = () => {
			const peaks = this.#peaks;
			waveBox.hidden = peaks === null;
			if (peaks) {
				paintWaveform(wave, peaks);
			}
		};
		this.#drawWaveform = drawWave;
		// The canvas has no size until the control is in the page, and it changes with the dialog.
		const resizes = new ResizeObserver(drawWave);
		resizes.observe(wave);
		this.own(() => resizes.disconnect());
		drawWave();

		const showMode = (/** @type {boolean} */ playing) => {
			track.dataset.mode = playing ? 'seek' : 'edit';
			track.title = playing ? 'Seek' : 'Drag the handles to choose the part that plays';
			handles.start.hidden = playing;
			handles.end.hidden = playing;
			startField.input.disabled = playing;
			endField.input.disabled = playing;
			reset.disabled = playing;
			unplayed.hidden = !playing;
			crossfade.hidden = !playing;
		};
		// The playhead and the crossfade stretch are shares of the part that plays, set inline (DESIGN.md §9.6).
		const showPosition = () => {
			const playback = this.#playback;
			const clipMs = this.#endMs - this.#startMs;
			if (!playback || clipMs <= 0) {
				return;
			}
			const played = Math.min(1, Math.max(0, playback.positionMs / clipMs));
			unplayed.style.width = `${(1 - played) * 100}%`;
			const from = playback.crossfadeFromMs;
			crossfade.hidden = from === null;
			if (from !== null) {
				crossfade.style.width = `${Math.max(0, 1 - from / clipMs) * 100}%`;
			}
		};
		this.#showMode = (playing) => {
			showMode(playing);
			// A fresh seek bar must not keep an old playhead, nor an editor keep a half-dragged handle.
			this.#dragging = null;
		};
		this.#showPosition = showPosition;
		showMode(this.#playback !== null);
		showPosition();

		this.own(on(track, 'pointerdown', (event) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			const ms = msAtPointer(event);
			if (this.#playback) {
				// Seeking: anywhere on the bar, within the part that plays.
				const within = Math.min(Math.max(ms, this.#startMs), this.#endMs);
				this.#onSeek((within - this.#startMs) / 1000);
				return;
			}
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
				const ms = parseTime(input.value);
				if (ms === null) {
					return false;
				}
				move(which, ms);
				input.value = toFieldText(which === 'start' ? this.#startMs : this.#endMs);
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
					input.value = toFieldText(which === 'start' ? this.#startMs : this.#endMs);
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

		return h('div', { 'class': 'space-y-3', 'data-range-control': true },
			h('div', {}, waveBox, track),
			h('div', { class: 'flex items-center text-sm' },
				startField.element,
				// A bar in the fields' underline color joins them, with Reset in its middle.
				h('div', { class: 'flex flex-1 items-center justify-center px-3' },
					h('div', { class: 'h-0.5 flex-1 bg-line' }),
					reset,
					h('div', { class: 'h-0.5 flex-1 bg-line' })),
				endField.element),
			length);
	}
}
