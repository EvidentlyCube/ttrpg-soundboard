import { Component } from './component.js';
import { h, on } from './dom.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** The kinds the language files name; any other shows as it is. */
const KINDS = ['unsupported-audio', 'orphan-options', 'symlink', 'empty-playlist', 'unknown-duration', 'play-failed', 'save-failed', 'download-failed', 'host-failed', 'host-lost', 'ytdlp-outdated'];

/** @param {string} kind */
const kindLabel = (kind) => (KINDS.includes(kind) ? t(`problems.kind.${/** @type {'symlink'} */ (kind)}`) : kind);

const BUTTON_CLASS = 'cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-raised-hover hover:text-text';

/**
 * Lists every problem (DESIGN.md §9.14), errors first, each with a Dismiss button; the footer dismisses all of them.
 * It follows `problems.changed` and closes itself once nothing is left.
 */
export class ProblemsDialog extends Component {
	#soundboard;
	#onEmpty;
	/** @type {HTMLElement | null} */
	#footer = null;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {() => void} options.onEmpty closes the dialog once nothing is left
	 */
	constructor({ soundboard, onEmpty }) {
		super();
		this.#soundboard = soundboard;
		this.#onEmpty = onEmpty;
	}

	/** The Dismiss all button, which the dialog keeps below the scrolling list. */
	get footer() {
		if (!this.#footer) {
			throw new Error('ProblemsDialog is not mounted');
		}
		return this.#footer;
	}

	/** @override */
	render() {
		const list = h('ul', { 'class': 'space-y-2', 'data-problems-list': true });
		const dismissAll = h('button', { 'type': 'button', 'class': BUTTON_CLASS, 'data-dismiss-all': true }, t('problems.dismissAll'));
		this.#footer = h('div', { class: 'flex justify-end' }, dismissAll);
		this.own(on(dismissAll, 'click', () => this.#soundboard.dismissAllProblems()));

		const fill = () => {
			const problems = this.#soundboard.getProblems();
			if (problems.length === 0) {
				this.#onEmpty();
				return;
			}
			// Errors first; the sort keeps the order within each group.
			const sorted = [...problems].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
			list.replaceChildren(...sorted.map((problem) => {
				const dismiss = h('button', { 'type': 'button', 'class': BUTTON_CLASS, 'data-dismiss': problem.id }, t('problems.dismiss'));
				dismiss.addEventListener('click', () => this.#soundboard.dismissProblem(problem.id));
				return h('li', {
					'class': 'flex items-start gap-3 rounded-md border border-line border-l-4 bg-raised-dim px-3 py-2 data-[severity=error]:border-l-danger data-[severity=warning]:border-l-notice',
					'data-severity': problem.severity,
					'data-problem': problem.id,
				},
				h('div', { class: 'min-w-0 flex-1' },
					h('div', { class: 'text-xs font-semibold text-muted uppercase' }, kindLabel(problem.kind), problem.count > 1 ? ` ×${problem.count}` : ''),
					h('div', { class: 'truncate text-sm', title: problem.path }, problem.path),
					h('div', { class: 'text-sm text-muted' }, problem.message)),
				dismiss);
			}));
		};
		fill();
		this.own(this.#soundboard.on('problems.changed', fill));
		return list;
	}
}
