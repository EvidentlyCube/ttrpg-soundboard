import { h, on } from './dom.js';

/**
 * A centered modal shared by the Customize dialogs. Every change in them applies at once, so closing never loses
 * anything: the × button, Esc and a click on the backdrop all close it. It sits below the splash, so a system audio
 * suspension covers it instead of closing it, and below popups, so a menu can still open on top of it.
 */
export class Dialog {
	/** @type {(() => void) | null} */
	#closeOpen = null;

	get isOpen() {
		return this.#closeOpen !== null;
	}

	/**
	 * Shows `body` under a title. Any dialog already open is closed first.
	 * @param {object} options
	 * @param {string} options.title
	 * @param {HTMLElement} options.body
	 * @param {() => void} [options.onClose] runs once, however the dialog closes
	 */
	open({ title, body, onClose }) {
		this.close();
		const close = h('button', {
			'type': 'button',
			'class': 'grid size-8 cursor-pointer place-items-center rounded-md text-xl leading-none text-muted hover:bg-raised-hover hover:text-text',
			'aria-label': 'Close',
			'title': 'Close',
			'data-dialog-close': true,
		}, '×');
		const panel = h('div', {
			'role': 'dialog',
			'aria-modal': 'true',
			'aria-label': title,
			'class': 'w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl',
			'data-dialog': true,
		},
		h('div', { class: 'flex items-center justify-between gap-4 border-b border-line px-5 py-3' },
			h('h2', { class: 'truncate text-base font-semibold' }, title), close),
		h('div', { class: 'px-5 py-4' }, body));
		const backdrop = h('div', {
			'class': 'fixed inset-0 z-30 grid place-items-center bg-black/50 p-4',
			'data-dialog-backdrop': true,
		}, panel);
		document.body.append(backdrop);

		const listeners = [
			on(close, 'click', () => this.close()),
			// Only a press that starts and ends on the backdrop itself closes it, so a drag out of a field never does.
			on(backdrop, 'pointerdown', (event) => {
				backdrop.dataset.pressed = String(event.target === backdrop);
			}),
			on(backdrop, 'click', (event) => {
				if (event.target === backdrop && backdrop.dataset.pressed === 'true') {
					this.close();
				}
			}),
			on(document, 'keydown', (event) => {
				if (event.key === 'Escape' && !document.querySelector('[data-overlay-backdrop]')) {
					this.close();
				}
			}),
		];
		this.#closeOpen = () => {
			for (const remove of listeners) {
				remove();
			}
			backdrop.remove();
			onClose?.();
		};
	}

	close() {
		const closeOpen = this.#closeOpen;
		this.#closeOpen = null;
		closeOpen?.();
	}
}
