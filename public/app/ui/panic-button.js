import { Component } from './component.js';
import { h, on } from './dom.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

const LABELS = { fade: '(Fade)', now: '(NOW!)' };

/**
 * The footer's Panic Stop button (DESIGN.md §9.1): "Stop (Fade)" fades everything out, and while that fades,
 * "Stop (NOW!)" cuts it all at once. The state belongs to the soundboard; this only shows it.
 */
export class PanicButton extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const mode = h('span', { class: 'text-xs font-medium' });
		const button = h('button', {
			'type': 'button',
			'class': 'flex h-full w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-notice bg-notice/15 text-base leading-tight font-bold text-notice hover:bg-notice/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-notice data-[state=now]:border-danger data-[state=now]:bg-danger data-[state=now]:text-surface data-[state=now]:hover:bg-danger data-[state=now]:hover:brightness-110 data-[state=now]:focus-visible:outline-danger',
			'title': 'Fade out everything that plays. Press again while it fades to stop it at once.',
			'data-panic-button': true,
		}, h('span', {}, 'Stop'), mode);

		const show = (/** @type {import('../logic/soundboard.js').PanicState} */ state) => {
			button.dataset.state = state;
			mode.textContent = LABELS[state];
		};
		show(soundboard.panicState());
		this.own(soundboard.on('panic.changed', ({ state }) => show(state)));
		this.own(on(button, 'click', () => soundboard.panicStop()));
		return button;
	}
}
