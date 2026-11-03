import { Component } from './component.js';
import { h, on } from './dom.js';

/** @typedef {import('../logic/soundboard.js').PanicState} PanicState */

/**
 * What the button needs: the soundboard has it, and so does a remote control (DESIGN.md §9.15).
 * @typedef {object} PanicSource
 * @property {() => PanicState} panicState
 * @property {() => void} panicStop
 * @property {(type: 'panic.changed', handler: (event: { state: PanicState }) => void) => () => void} on
 */

const LABELS = { fade: 'Stop All', now: 'STOP NOW!' };

/**
 * The footer's Panic Stop button (DESIGN.md §9.1): "Stop All" fades everything out, and while that fades,
 * "STOP NOW!" cuts it all at once. The state belongs to the soundboard; this only shows it.
 */
export class PanicButton extends Component {
	#soundboard;
	#disabled;

	/**
	 * @param {PanicSource} soundboard
	 * @param {{ disabled?: boolean }} [options] disabled while nothing can play yet
	 */
	constructor(soundboard, { disabled = false } = {}) {
		super();
		this.#soundboard = soundboard;
		this.#disabled = disabled;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const mode = h('span', {});
		const button = h('button', {
			'type': 'button',
			'class': 'flex h-full w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-notice bg-notice/15 text-base leading-tight font-bold text-notice hover:bg-notice/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-notice data-[state=now]:border-danger data-[state=now]:bg-danger data-[state=now]:text-surface data-[state=now]:hover:bg-danger data-[state=now]:hover:brightness-110 data-[state=now]:focus-visible:outline-danger disabled:cursor-default disabled:opacity-40 disabled:hover:bg-notice/15',
			'title': 'Fade out everything that plays. Press again while it fades to stop it at once.',
			'disabled': this.#disabled,
			'data-panic-button': true,
		}, mode);

		const show = (/** @type {PanicState} */ state) => {
			button.dataset.state = state;
			mode.textContent = LABELS[state];
		};
		show(soundboard.panicState());
		this.own(soundboard.on('panic.changed', ({ state }) => show(state)));
		this.own(on(button, 'click', () => soundboard.panicStop()));
		return button;
	}
}
