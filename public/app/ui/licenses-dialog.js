import { Component } from './component.js';
import { card } from './customize-parts.js';
import { h } from './dom.js';
import { t } from './text.js';

/** @typedef {import('../logic/ports.js').Licenses} Licenses */
/** @typedef {import('../logic/ports.js').IncludedPart} IncludedPart */
/** @typedef {import('./dialog.js').Dialog} Dialog */

const LINK = 'text-music underline-offset-2 hover:underline';
const LIST = 'divide-y divide-line rounded-lg border border-line bg-panel';

/**
 * The body of the Licenses dialog, shared by the Selector and the board (DESIGN.md §9.22): the parts the app is made
 * of, each with its license, then the programs it runs without shipping them.
 */
export class LicensesDialog extends Component {
	#load;

	/** @param {() => Promise<Licenses>} load */
	constructor(load) {
		super();
		this.#load = load;
	}

	/** @override */
	render() {
		const body = h('div', { 'class': 'min-w-80 text-sm', 'data-licenses': true }, h('p', { class: 'text-muted' }, t('common.loading')));
		this.#load().then(
			(licenses) => body.replaceChildren(content(licenses)),
			() => body.replaceChildren(h('p', { class: 'text-danger' }, t('licenses.failed'))),
		);
		return body;
	}
}

/**
 * Opens the Licenses dialog in `dialog`.
 * @param {Dialog} dialog
 * @param {() => Promise<Licenses>} load
 */
export function openLicenses(dialog, load) {
	const licenses = new LicensesDialog(load);
	const body = h('div');
	licenses.mount(body);
	dialog.open({ title: t('licenses.title'), body, onClose: () => licenses.destroy() });
}

/**
 * @param {Licenses} licenses
 * @returns {HTMLElement}
 */
function content({ included, external }) {
	return h('div', { class: 'space-y-6 pt-3' },
		card(t('licenses.included'), 'neutral',
			h('ul', { class: LIST }, ...included.map(partRow))),
		external.length === 0
			? null
			: card(t('licenses.external'), 'neutral', h('div', { class: 'space-y-2' },
					h('p', { class: 'text-xs text-muted' }, t('licenses.externalHint')),
					h('ul', { class: LIST }, ...external.map(externalRow)))));
}

/**
 * @param {Licenses['external'][number]} program
 * @returns {HTMLElement}
 */
function externalRow(program) {
	return h('li', { 'class': 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2', 'data-license-external': program.id },
		h('span', { class: 'font-medium' }, program.name),
		h('a', { class: `text-xs ${LINK}`, href: program.url, target: '_blank', rel: 'noopener noreferrer' }, t('licenses.website')));
}

/**
 * @param {IncludedPart} part
 * @returns {HTMLElement}
 */
function partRow(part) {
	// Node's license alone is over 100 KB, so a text is only put on the page once asked for.
	const text = h('pre', {
		'class': 'mt-2 max-h-[50vh] overflow-auto rounded-md bg-surface p-3 font-mono text-xs whitespace-pre-wrap text-muted',
		'hidden': true,
		'data-license-text': true,
	});
	const toggle = part.text === null
		? null
		: h('button', {
				'type': 'button',
				'class': `cursor-pointer text-xs ${LINK}`,
				'aria-expanded': 'false',
				'data-license-toggle': true,
				'onClick': () => {
					const show = text.hidden;
					if (show && text.textContent === '') {
						text.textContent = part.text;
					}
					text.hidden = !show;
					toggle?.setAttribute('aria-expanded', String(show));
					if (toggle) {
						toggle.textContent = show ? t('licenses.hide') : t('licenses.show');
					}
				},
			}, t('licenses.show'));
	const online = part.text === null && part.url !== null
		? h('a', { class: `text-xs ${LINK}`, href: part.url, target: '_blank', rel: 'noopener noreferrer' }, t('licenses.online'))
		: null;
	return h('li', { 'class': 'px-3 py-2', 'data-license-row': part.id },
		h('div', { class: 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1' },
			h('div', { class: 'flex items-baseline gap-2' },
				h('span', { class: 'font-medium' }, part.name),
				part.version === null ? null : h('span', { class: 'text-xs text-muted tabular-nums' }, part.version)),
			h('div', { class: 'flex items-baseline gap-3' },
				h('span', { class: 'text-xs text-muted' }, part.license),
				toggle,
				online)),
		text);
}
