import { Component } from './component.js';
import { h } from './dom.js';

/**
 * The full-screen message shown before audio may start, while loading, after a failed start, and when the system
 * suspends audio (DESIGN.md §9.0). The whole screen is the click target.
 */
export class Splash extends Component {
	#onClick;
	#message = h('p', { class: 'text-lg text-text' });
	#detail = h('p', { class: 'max-w-xl text-center text-sm text-muted' });

	/** @param {() => void} onClick */
	constructor(onClick) {
		super();
		this.#onClick = onClick;
	}

	/** @override */
	render() {
		return h('div', {
			'class': 'fixed inset-0 z-50 flex cursor-pointer select-none flex-col items-center justify-center gap-3 bg-surface/95',
			'data-splash': true,
			'onClick': () => this.#onClick(),
		}, h('h1', { class: 'text-4xl font-semibold tracking-tight text-text' }, 'Soundboard'), this.#message, this.#detail);
	}

	/**
	 * @param {string} message
	 * @param {string} [detail]
	 */
	show(message, detail = '') {
		this.#message.textContent = message;
		this.#detail.textContent = detail;
		this.element.hidden = false;
	}

	hide() {
		this.element.hidden = true;
	}
}
