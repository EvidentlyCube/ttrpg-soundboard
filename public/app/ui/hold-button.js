import { h, on } from './dom.js';
import { t } from './text.js';

/** How long the button must be held down, unless it says otherwise. */
export const HOLD_MS = 500;

/** Colors per tone, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const TONES = {
	danger: { button: 'border-danger/60 text-danger hover:bg-danger/10', fill: 'bg-danger/35' },
	neutral: { button: 'border-line text-text hover:bg-raised-hover', fill: 'bg-text/20' },
};

/**
 * A button that acts only after being held down, half a second by default, by pointer or with Enter or Space, so a slip
 * of the hand never deletes anything. A fill sweeps across it while it is held; letting go early cancels. The fill is
 * a CSS transition started by `data-holding`, so nothing updates while it runs (DESIGN.md §9.6); its length is an
 * inline style, since Tailwind can't build a class from a variable.
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.busyLabel shown while the action runs
 * @param {() => void} options.onHold
 * @param {number} [options.holdMs]
 * @param {keyof typeof TONES} [options.tone] red for deleting, neutral for anything else
 * @returns {{ element: HTMLButtonElement, setBusy: (busy: boolean) => void, destroy: () => void }}
 */
export function holdButton({ label, busyLabel, onHold, holdMs = HOLD_MS, tone = 'danger' }) {
	const colors = TONES[tone];
	const seconds = holdMs / 1000;
	const text = h('span', { class: 'relative' }, label);
	const fill = h('span', {
		'class': `absolute inset-y-0 left-0 w-0 ${colors.fill} transition-none group-data-[holding=true]/hold:w-full group-data-[holding=true]/hold:transition-[width] group-data-[holding=true]/hold:ease-linear`,
		'aria-hidden': 'true',
	});
	fill.style.transitionDuration = `${holdMs}ms`;
	const element = h('button', {
		'type': 'button',
		'class': `group/hold relative cursor-pointer touch-none overflow-hidden rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-60 ${colors.button}`,
		'title': t('common.holdToConfirm', { count: seconds }),
		'data-holding': 'false',
		'data-hold-button': true,
	}, fill, text);

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
		}, holdMs);
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
