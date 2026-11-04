import { h } from './dom.js';
import { describe, t } from './text.js';

/** @typedef {import('../logic/startup-flow.js').StartupState['tools']} ToolsInfo */

/**
 * The app name and what the page is for, at the top of the Selector and the Initializer.
 * @param {string} subtitle
 */
export function pageHeader(subtitle) {
	const line = h('p', { 'class': 'text-muted', 'data-page-subtitle': true }, subtitle);
	return h('header', { class: 'space-y-1' }, h('h1', { class: 'text-2xl font-semibold tracking-tight' }, t('app.name')), line);
}

/** @returns {{ element: HTMLElement, show: (visible: boolean) => void }} said while the server doesn't answer */
export function connectionNotice() {
	const element = h('p', {
		'class': 'rounded-md border border-notice/50 bg-notice/10 px-3 py-2 text-sm text-notice',
		'data-connection-lost': true,
		'hidden': true,
	}, t('startup.noAnswer'));
	return { element, show: (visible) => void (element.hidden = !visible) };
}

/** @returns {HTMLElement} where the last action's failure is shown */
export function errorNotice() {
	return h('p', {
		'class': 'rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger',
		'data-startup-error': true,
		'hidden': true,
	});
}

/**
 * @param {HTMLElement} element from `errorNotice`
 * @param {import('../logic/errors.js').CodedText | null} error
 */
export function showError(element, error) {
	element.hidden = error === null;
	element.textContent = error ? describe(error) : '';
}

/**
 * The Selector's title bar, styled like the Soundboard page's, with the app's version and the download tools' state (DESIGN.md §9.18).
 * @param {string} title
 * @param {HTMLElement} [start] shown before the title, such as the ☰ button
 * @returns {{ element: HTMLElement, show: (tools: ToolsInfo) => void }}
 */
export function toolsHeader(title, start) {
	const app = h('span', { 'class': 'text-xs text-muted', 'data-app-version': true });
	const ytDlp = h('span', { 'data-tool': 'yt-dlp' });
	const ffmpeg = h('span', { 'data-tool': 'ffmpeg' });
	const element = h('header', {
		class: 'sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-panel px-5 py-3',
	},
	h('div', { class: 'flex items-center gap-3' },
		start,
		h('div', { class: 'flex items-baseline gap-2' }, h('h1', { class: 'text-lg font-semibold tracking-tight' }, title), app)),
	h('div', { class: 'flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-xs text-muted' }, ytDlp, ffmpeg));
	let drawn = '';
	return {
		element,
		show: (tools) => {
			const key = JSON.stringify(tools);
			if (key === drawn) {
				return;
			}
			drawn = key;
			app.textContent = `v${tools.app}`;
			const update = tools.ytDlp.update;
			const updateText = update === null ? '' : update.state === 'current' ? ' ✓' : ` · ${t(`startup.tools.${update.state}`)}`;
			ytDlp.replaceChildren(...toolText('yt-dlp', tools.ytDlp.version, tools.checking, updateText));
			ytDlp.title = update?.error ?? (update?.state === 'current' ? t('info.upToDate') : '');
			ffmpeg.replaceChildren(...toolText('ffmpeg', tools.ffmpeg, tools.checking, ''));
		},
	};
}

/**
 * @param {string} name
 * @param {string | null} version
 * @param {boolean} checking
 * @param {string} suffix
 * @returns {(string | Node)[]}
 */
function toolText(name, version, checking, suffix) {
	if (version === null) {
		return [`${name}: `, checking ? t('startup.tools.checking') : h('span', { class: 'text-notice' }, t('startup.tools.missing'))];
	}
	return [`${name} ${version}${suffix}${checking && name === 'yt-dlp' ? ` · ${t('startup.tools.checkingUpdates')}` : ''}`];
}
