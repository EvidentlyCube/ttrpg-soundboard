import { Component } from './component.js';
import { h, on } from './dom.js';
import { holdButton } from './hold-button.js';
import { t } from './text.js';

/** How long taking over must be held, so a slip never silences the host. */
const REPLACE_HOLD_MS = 1000;

/**
 * The body of the dialog that asks before this page takes the host role from another one (DESIGN.md §9.15). The other
 * page turns standalone and keeps playing what it plays; this one becomes the host. The footer holds the buttons.
 */
export class ReplaceHostDialog extends Component {
	#onReplace;
	#onCancel;
	/** @type {ReturnType<typeof holdButton> | null} */
	#hold = null;

	/**
	 * @param {object} options
	 * @param {() => void} options.onReplace the take-over button was held
	 * @param {() => void} options.onCancel
	 */
	constructor({ onReplace, onCancel }) {
		super();
		this.#onReplace = onReplace;
		this.#onCancel = onCancel;
	}

	/** @override */
	render() {
		return h('div', { class: 'space-y-3 text-sm' },
			h('p', {}, t('replaceHost.intro')),
			h('p', { class: 'text-muted' }, t('replaceHost.explanation')));
	}

	/** The buttons, to show below the body. */
	get footer() {
		const hold = holdButton({
			label: t('replaceHost.hold'),
			busyLabel: t('replaceHost.takingOver'),
			holdMs: REPLACE_HOLD_MS,
			tone: 'neutral',
			onHold: () => {
				hold.setBusy(true);
				this.#onReplace();
			},
		});
		this.#hold = hold;
		const cancel = h('button', {
			'type': 'button',
			'class': 'cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-raised-hover hover:text-text',
			'data-cancel': true,
		}, t('common.cancel'));
		this.own(on(cancel, 'click', () => this.#onCancel()));
		hold.element.dataset.replaceHost = 'true';
		return h('div', { class: 'flex justify-end gap-3' }, cancel, hold.element);
	}

	/** @override */
	destroy() {
		this.#hold?.destroy();
		super.destroy();
	}
}
