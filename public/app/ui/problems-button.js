import { Component } from './component.js';
import { h, on } from './dom.js';
import { icon } from './icons.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The header's Problems button (DESIGN.md §9.1): red while any problem is an error, yellow while all are warnings,
 * and shown only while there are problems.
 */
export class ProblemsButton extends Component {
	#soundboard;
	#onOpen;

	/**
	 * @param {Soundboard} soundboard
	 * @param {() => void} onOpen opens the problems dialog
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
			'class': 'flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold whitespace-nowrap hover:brightness-125 data-[severity=error]:border-danger data-[severity=error]:text-danger data-[severity=warning]:border-notice data-[severity=warning]:text-notice',
			'title': t('problems.buttonTooltip'),
			'data-problems-button': true,
		}, icon('alert', 'size-4'), label);
		const show = () => {
			const problems = this.#soundboard.getProblems();
			button.hidden = problems.length === 0;
			button.dataset.severity = problems.some((problem) => problem.severity === 'error') ? 'error' : 'warning';
			label.textContent = t('problems.count', { count: problems.length });
		};
		show();
		this.own(this.#soundboard.on('problems.changed', show));
		this.own(on(button, 'click', () => this.#onOpen()));
		return button;
	}
}
