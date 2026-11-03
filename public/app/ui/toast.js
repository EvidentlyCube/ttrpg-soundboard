import { h } from './dom.js';

/** @type {HTMLElement | null} */
let toast = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/**
 * A short note in the bottom-right corner that fades away by itself. A new one replaces the one showing.
 * @param {string} message
 * @param {object} [options]
 * @param {'info' | 'danger'} [options.tone]
 * @param {number} [options.ms] how long it stays before it fades
 */
export function showToast(message, { tone = 'info', ms = 1000 } = {}) {
	if (!toast) {
		toast = h('div', {
			'class': 'pointer-events-none fixed right-4 bottom-4 z-[70] max-w-sm rounded-md border border-line bg-panel px-4 py-2 text-sm text-text opacity-0 shadow-lg transition-opacity duration-300 data-[tone=danger]:border-danger/50 data-[tone=danger]:text-danger data-[visible=true]:opacity-100',
			'role': 'status',
			'data-toast': true,
			'data-visible': 'false',
		});
		document.body.append(toast);
	}
	const element = toast;
	element.dataset.tone = tone;
	element.textContent = message;
	element.dataset.visible = 'true';
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		element.dataset.visible = 'false';
	}, ms);
}
