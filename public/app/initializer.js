import { HttpStartupApi } from './api/startup-api.js';
import { browserClock } from './browser-clock.js';
import { loadLanguage } from './language.js';
import { StartupFlow } from './logic/startup-flow.js';
import { h } from './ui/dom.js';
import { holdButton } from './ui/hold-button.js';
import { connectionNotice, errorNotice, pageHeader, showError } from './ui/startup-parts.js';
import { t } from './ui/text.js';

/** @typedef {import('./logic/startup-flow.js').StartupView} StartupView */
/** @typedef {import('./logic/startup-flow.js').InitializerState} InitializerState */
/** @typedef {import('./logic/startup-flow.js').StartupQuestion} StartupQuestion */

const BUTTON = 'cursor-pointer rounded-md bg-raised px-4 py-1.5 text-sm font-medium hover:bg-raised-hover disabled:cursor-default disabled:opacity-50';
const PRIMARY = 'cursor-pointer rounded-md bg-music px-4 py-1.5 text-sm font-semibold text-surface hover:brightness-110 disabled:cursor-default disabled:opacity-50';
/** Long lists are cut here; the rest is counted. */
const MAX_LISTED = 200;

await loadLanguage();

const root = document.getElementById('initializer');
if (!root) {
	throw new Error('initializer.html is missing the #initializer element');
}

const flow = new StartupFlow({
	api: new HttpStartupApi(),
	clock: browserClock,
	phase: 'initializing',
	onChange: render,
	onLeave: () => window.location.assign('/'),
});

const offline = connectionNotice();
const error = errorNotice();
const folder = h('div', { class: 'min-w-0' });
const body = h('section', { 'class': 'space-y-4 rounded-lg border border-line bg-panel p-5', 'data-initializer-step': '' });
root.replaceChildren(h('main', { class: 'mx-auto w-full max-w-3xl flex-1 space-y-6 px-5 py-8' },
	pageHeader(t('initializer.title')),
	folder,
	offline.element,
	error,
	body));

let drawn = '';
/** @type {{ bar: HTMLElement, text: HTMLElement } | null} */
let progress = null;

/** @param {StartupView} view */
function render(view) {
	offline.show(!view.connected);
	showError(error, view.error);
	const initializer = view.state?.initializer;
	if (!initializer) {
		return;
	}
	// Progress changes on every poll, so it is updated in place rather than drawn again (DESIGN.md §9.6).
	const { progress: measured, ...rest } = initializer;
	const key = JSON.stringify([rest, measured === null, view.busy]);
	if (key !== drawn) {
		drawn = key;
		progress = null;
		folder.replaceChildren(
			h('p', { class: 'truncate text-lg font-semibold' }, initializer.root.split(/[\\/]/).filter(Boolean).pop() ?? initializer.root),
			h('p', { class: 'truncate text-sm text-muted', title: initializer.root }, initializer.root),
		);
		body.dataset.initializerStep = initializer.step;
		body.replaceChildren(...drawStep(initializer, view.busy));
	}
	if (progress && measured) {
		progress.bar.style.width = `${(100 * measured.done) / Math.max(1, measured.total)}%`;
		progress.text.textContent = t('initializer.measuringProgress', { done: measured.done, total: measured.total });
	}
}

/**
 * @param {InitializerState} initializer
 * @param {boolean} busy
 * @returns {Node[]}
 */
function drawStep(initializer, busy) {
	switch (initializer.step) {
		case 'scanning':
			return [status(t('initializer.scanning'))];
		case 'starting':
			return [status(t('initializer.starting'))];
		case 'waitingForTools':
			return [status(t('initializer.waitingForTools'))];
		case 'measuring': {
			const text = status(t('initializer.measuring'));
			const bar = h('div', { class: 'h-full w-0 rounded-full bg-music transition-[width]' });
			progress = { bar, text };
			return [
				text,
				h('div', { 'class': 'h-2 overflow-hidden rounded-full bg-raised', 'data-progress': true }, bar),
				h('p', { class: 'text-xs text-muted' }, t('initializer.measuringNote')),
			];
		}
		case 'question':
			return initializer.question ? drawQuestion(initializer.question, busy) : [];
		case 'failed':
			return drawFailure(initializer, busy);
	}
}

/**
 * @param {StartupQuestion} question
 * @param {boolean} busy
 * @returns {Node[]}
 */
function drawQuestion(question, busy) {
	/**
	 * @param {string} yes
	 * @param {string} no
	 */
	const buttons = (yes, no) => h('div', { class: 'flex flex-wrap justify-end gap-2' },
		h('button', { 'type': 'button', 'class': BUTTON, 'disabled': busy, 'data-answer': 'no', 'onClick': () => flow.answer(question.id, false) }, no),
		h('button', { 'type': 'button', 'class': PRIMARY, 'disabled': busy, 'data-answer': 'yes', 'onClick': () => flow.answer(question.id, true) }, yes));
	switch (question.kind) {
		case 'largeFolder':
			return [
				h('p', { class: 'font-semibold' }, t('initializer.largeFolder', { count: question.count })),
				h('p', { class: 'text-sm text-muted' }, t('initializer.largeFolderHint')),
				buttons(t('initializer.largeFolderYes'), t('initializer.back')),
			];
		case 'nestedDirectories':
			return [
				h('p', { class: 'font-semibold' }, t('initializer.nested')),
				list(question.paths.map((path) => h('li', { class: 'font-mono text-danger' }, path))),
				h('p', { class: 'text-sm text-muted' }, t('initializer.nestedHint')),
				buttons(t('initializer.nestedYes'), t('initializer.back')),
			];
		case 'metadataTitles':
			return [
				h('p', { class: 'font-semibold' }, t('initializer.titles')),
				list(question.titles.map(({ path, title }) => h('li', { class: 'flex gap-2' },
					h('span', { class: 'min-w-0 truncate font-mono text-muted', title: path }, path),
					h('span', { class: 'shrink-0' }, '→'),
					h('span', { class: 'min-w-0 truncate' }, `“${title}”`)))),
				h('p', { class: 'text-sm text-muted' }, t('initializer.titlesHint')),
				buttons(t('initializer.titlesYes'), t('initializer.titlesNo')),
			];
	}
}

/**
 * @param {InitializerState} initializer
 * @param {boolean} busy
 * @returns {Node[]}
 */
function drawFailure(initializer, busy) {
	const back = h('button', { 'type': 'button', 'class': BUTTON, 'disabled': busy, 'data-startup-action': 'back', 'onClick': () => flow.back() }, t('initializer.back'));
	const retry = h('button', { 'type': 'button', 'class': BUTTON, 'disabled': busy, 'data-startup-action': 'retry', 'onClick': () => flow.retry() }, t('initializer.retry'));
	const remove = initializer.canDelete && initializer.failures.length > 0
		? holdButton({ label: t('initializer.holdToDelete'), busyLabel: t('customize.deleting'), holdMs: 1000, onHold: () => flow.deleteAndRetry() })
		: null;
	remove?.setBusy(busy);
	return [
		h('p', { class: 'font-semibold text-danger' }, initializer.failures.length > 0
			? t('initializer.unreadable')
			: t('initializer.failed')),
		initializer.error ? h('p', { 'class': 'text-sm', 'data-startup-failure': true }, initializer.error) : null,
		initializer.failures.length > 0
			? list(initializer.failures.map((failure) => h('li', { 'class': 'space-y-0.5', 'data-startup-failure': failure.path },
					h('p', { class: 'font-mono text-danger' }, failure.path || t('initializer.noFile')),
					...failure.problems.map((problem) => h('p', { class: 'pl-4 text-muted' }, problem)))))
			: null,
		h('p', { class: 'text-sm text-muted' }, remove
			? t('initializer.fixOrDelete')
			: t('initializer.fixOrBack')),
		h('div', { class: 'flex flex-wrap justify-end gap-2' }, back, retry, remove?.element),
	].filter((node) => node !== null);
}

/** @param {string} text */
function status(text) {
	return h('p', { 'class': 'text-sm', 'data-startup-status': true }, text);
}

/** @param {HTMLElement[]} items */
function list(items) {
	const shown = items.slice(0, MAX_LISTED);
	return h('ul', { class: 'max-h-[50vh] space-y-1 overflow-y-auto rounded-md bg-raised px-3 py-2 text-sm' },
		...shown,
		items.length > MAX_LISTED ? h('li', { class: 'text-muted' }, t('initializer.more', { count: items.length - MAX_LISTED })) : null);
}

flow.start();
