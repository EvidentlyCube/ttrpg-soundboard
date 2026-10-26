import { h, on } from './dom.js';
import { placeInViewport } from './position.js';

/**
 * The single popup layer shared by context menus and the track list (DESIGN.md §9.3). A dimmed backdrop covers the
 * page, so clicks outside the popup only close it and never reach the board underneath.
 */
export class Overlay {
	/** @type {(() => void) | null} */
	#closeOpen = null;

	get isOpen() {
		return this.#closeOpen !== null;
	}

	/**
	 * Shows `panel` at `point`, flipped or clamped so it stays on screen. Any popup already open is closed first.
	 * @param {HTMLElement} panel
	 * @param {{ x: number, y: number }} point
	 */
	open(panel, point) {
		this.close();
		const backdrop = h('div', { 'class': 'fixed inset-0 z-40 bg-black/35', 'data-overlay-backdrop': true });
		panel.classList.add('fixed', 'z-50');
		Object.assign(panel.style, { left: '0px', top: '0px', visibility: 'hidden' });
		document.body.append(backdrop, panel);

		const { width, height } = panel.getBoundingClientRect();
		const { x, y } = placeInViewport(point, { width, height }, { width: window.innerWidth, height: window.innerHeight });
		Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, visibility: '' });

		/** @param {Event} event */
		const swallow = (event) => {
			event.preventDefault();
			event.stopPropagation();
		};
		// Closing on `click` rather than `pointerdown` keeps the whole press on the backdrop, so the element under the
		// cursor never receives a stray click once the backdrop is gone.
		const listeners = [
			on(backdrop, 'pointerdown', swallow),
			on(backdrop, 'click', (event) => {
				swallow(event);
				this.close();
			}),
			on(backdrop, 'contextmenu', (event) => {
				swallow(event);
				this.close();
			}),
			on(document, 'keydown', (event) => {
				if (event.key === 'Escape') {
					this.close();
				}
			}),
		];
		this.#closeOpen = () => {
			for (const remove of listeners) {
				remove();
			}
			backdrop.remove();
			panel.remove();
		};
		/** @type {HTMLElement | null} */ (panel.querySelector('button:not([disabled])'))?.focus();
	}

	close() {
		const closeOpen = this.#closeOpen;
		this.#closeOpen = null;
		closeOpen?.();
	}
}
