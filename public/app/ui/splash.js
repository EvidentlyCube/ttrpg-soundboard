import { Component } from './component.js';
import { h } from './dom.js';

/** @typedef {'standalone' | 'host' | 'remote'} StartMode */

/** What each choice says, and the colors that tell it apart, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const CHOICES = /** @type {const} */ ([
	{ mode: 'standalone', title: 'Standalone', text: 'Plays here. Nothing can control it.', color: 'border-line hover:border-text/50 hover:bg-raised-hover' },
	{ mode: 'host', title: 'Host', text: 'Plays here, and a remote control can control it.', color: 'border-host/60 hover:border-host hover:bg-host/10' },
	{ mode: 'remote', title: 'Remote control', text: 'Controls the host on another device. Plays no sound.', color: 'border-remote/60 hover:border-remote hover:bg-remote/10' },
]);

/**
 * The full-screen message shown before audio may start, while loading, after a failed start, and when the system
 * suspends audio (DESIGN.md §9.0). At the start it offers the three ways to use the page; for every other message the
 * whole screen is the click target.
 */
export class Splash extends Component {
	#onClick;
	#onChoose;
	#message = h('p', { class: 'text-lg text-text' });
	#detail = h('p', { class: 'max-w-xl text-center text-sm text-muted' });
	#choices = h('div', { class: 'mt-4 flex flex-col items-stretch gap-4 sm:flex-row sm:items-start' });
	#hostNote = h('p', { 'class': 'mt-2 text-xs text-muted', 'data-host-note': true });
	#remoteNote = h('p', { 'class': 'mt-2 text-xs text-notice', 'data-remote-note': true });

	/**
	 * @param {object} options
	 * @param {() => void} options.onClick the screen was clicked while it shows a message
	 * @param {(mode: StartMode) => void} options.onChoose one of the choices was pressed
	 */
	constructor({ onClick, onChoose }) {
		super();
		this.#onClick = onClick;
		this.#onChoose = onChoose;
	}

	/** @override */
	render() {
		const notes = { host: this.#hostNote, remote: this.#remoteNote };
		for (const { mode, title, text, color } of CHOICES) {
			const button = h('button', {
				'type': 'button',
				'class': `w-64 cursor-pointer rounded-xl border-2 bg-raised p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${color}`,
				'data-start-mode': mode,
				'onClick': () => this.#onChoose(mode),
			}, h('span', { class: 'block text-lg font-semibold' }, title), h('span', { class: 'mt-1 block text-sm text-muted' }, text));
			const note = mode === 'host' || mode === 'remote' ? notes[mode] : null;
			this.#choices.append(h('div', { class: 'w-64' }, button, note));
		}
		return h('div', {
			'class': 'fixed inset-0 z-50 flex cursor-pointer select-none flex-col items-center justify-center gap-3 bg-surface/95 data-[mode=choices]:cursor-default',
			'data-splash': true,
			'data-mode': 'message',
			'onClick': () => {
				if (this.element.dataset.mode === 'message') {
					this.#onClick();
				}
			},
		}, h('h1', { class: 'text-4xl font-semibold tracking-tight text-text' }, 'Soundboard'), this.#message, this.#detail, this.#choices);
	}

	/**
	 * @param {string} message
	 * @param {string} [detail]
	 */
	show(message, detail = '') {
		this.#message.textContent = message;
		this.#detail.textContent = detail;
		this.#choices.hidden = true;
		this.element.dataset.mode = 'message';
		this.element.hidden = false;
	}

	/** Shows the three ways to start. */
	showChoices() {
		this.#message.textContent = 'Choose how to start';
		this.#detail.textContent = '';
		this.#choices.hidden = false;
		this.element.dataset.mode = 'choices';
		this.element.hidden = false;
	}

	/**
	 * Warns where it matters: replacing a host is a bigger step than becoming one, and a remote with no host has nothing to
	 * control yet.
	 * @param {boolean | null} hostExists null when the server could not say
	 */
	setHostStatus(hostExists) {
		this.#hostNote.textContent = hostExists === true ? 'Another page is the host. You will be asked before it is replaced.' : '';
		this.#remoteNote.textContent = hostExists === false ? 'No host is running yet. It will work once one starts.' : '';
	}

	hide() {
		this.element.hidden = true;
	}
}
