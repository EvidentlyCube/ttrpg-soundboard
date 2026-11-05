import { Component } from './component.js';
import { h, on } from './dom.js';
import { formatMegabytes } from './format.js';
import { icon } from './icons.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** The header's Trash button with the trash's size (DESIGN.md §9.1), shown only while the trash holds something. */
export class TrashButton extends Component {
	#soundboard;
	#onOpen;

	/**
	 * @param {Soundboard} soundboard
	 * @param {() => void} onOpen opens the trash dialog
	 */
	constructor(soundboard, onOpen) {
		super();
		this.#soundboard = soundboard;
		this.#onOpen = onOpen;
	}

	/** @override */
	render() {
		const label = h('span', {});
		const button = h('button', {
			'type': 'button',
			'class': 'flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm whitespace-nowrap text-muted hover:bg-raised-hover hover:text-text',
			'title': t('trash.buttonTooltip'),
			'data-trash-button': true,
		}, icon('trash-can', 'size-4'), label);
		/** @param {import('../logic/ports.js').TrashSummary} summary */
		const show = ({ size, count }) => {
			button.hidden = count === 0;
			label.textContent = t('trash.button', { size: formatMegabytes(size) });
		};
		show(this.#soundboard.trashSummary());
		this.own(this.#soundboard.on('trash.changed', show));
		this.own(on(button, 'click', () => this.#onOpen()));
		return button;
	}
}
