import { h, on } from './dom.js';

/** How long the button must be held down. */
export const HOLD_MS = 1000;

/**
 * A button that acts only after being held down for a second, by pointer or with Enter or Space, so a slip of the
 * hand never deletes anything. A red fill sweeps across it while it is held; letting go early cancels. The fill is
 * a CSS transition started by `data-holding`, so nothing updates while it runs (DESIGN.md §9.6).
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.busyLabel shown while the action runs
 * @param {() => void} options.onHold
 * @returns {{ element: HTMLButtonElement, setBusy: (busy: boolean) => void, destroy: () => void }}
 */
export function holdButton({ label, busyLabel, onHold }) {
	const text = h('span', { class: 'relative' }, label);
	const element = h('button', {
		'type': 'button',
		'class': 'group/hold relative cursor-pointer touch-none overflow-hidden rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger select-none hover:bg-danger/10 disabled:cursor-default disabled:opacity-60',
		'title': `Hold for ${HOLD_MS / 1000} second to confirm`,
		'data-holding': 'false',
		'data-hold-button': true,
	},
	h('span', {
		'class': 'absolute inset-y-0 left-0 w-0 bg-danger/35 transition-none group-data-[holding=true]/hold:w-full group-data-[holding=true]/hold:transition-[width] group-data-[holding=true]/hold:duration-1000 group-data-[holding=true]/hold:ease-linear',
		'aria-hidden': 'true',
	}),
	text);

	/** @type {ReturnType<typeof setTimeout> | null} */
	let timer = null;
	const start = () => {
		if (timer !== null || element.disabled) {
			return;
		}
		element.dataset.holding = 'true';
		timer = setTimeout(() => {
			timer = null;
			element.dataset.holding = 'false';
			onHold();
		}, HOLD_MS);
	};
	const cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		element.dataset.holding = 'false';
	};
	const isHoldKey = (/** @type {KeyboardEvent} */ event) => event.key === 'Enter' || event.key === ' ';

	const listeners = [
		on(element, 'pointerdown', (event) => {
			if (event.button === 0) {
				start();
			}
		}),
		on(element, 'pointerup', cancel),
		on(element, 'pointerleave', cancel),
		on(element, 'pointercancel', cancel),
		on(element, 'blur', cancel),
		on(element, 'keydown', (event) => {
			if (isHoldKey(event)) {
				// Space would otherwise scroll the dialog, and Enter would repeat.
				event.preventDefault();
				if (!event.repeat) {
					start();
				}
			}
		}),
		on(element, 'keyup', (event) => {
			if (isHoldKey(event)) {
				cancel();
			}
		}),
	];

	return {
		element,
		setBusy: (busy) => {
			cancel();
			element.disabled = busy;
			text.textContent = busy ? busyLabel : label;
		},
		destroy: () => {
			cancel();
			for (const remove of listeners) {
				remove();
			}
		},
	};
}
