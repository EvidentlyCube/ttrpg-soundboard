import { h } from './dom.js';

/** @typedef {import('../logic/startup-flow.js').StartupState['tools']} ToolsInfo */

/**
 * The app name and what the page is for, at the top of the Selector and the Initializer.
 * @param {string} subtitle
 */
export function pageHeader(subtitle) {
	const line = h('p', { 'class': 'text-muted', 'data-page-subtitle': true }, subtitle);
	return h('header', { class: 'space-y-1' }, h('h1', { class: 'text-2xl font-semibold tracking-tight' }, 'Soundboard'), line);
}

/** @returns {{ element: HTMLElement, show: (visible: boolean) => void }} said while the server doesn't answer */
export function connectionNotice() {
	const element = h('p', {
		'class': 'rounded-md border border-notice/50 bg-notice/10 px-3 py-2 text-sm text-notice',
		'data-connection-lost': true,
		'hidden': true,
	}, 'The app doesn’t answer. If it was stopped, start it again; this page carries on by itself.');
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
 * @param {string | null} message
 */
export function showError(element, message) {
	element.hidden = message === null;
	element.textContent = message ?? '';
}

/**
 * The app's version and the download tools' state, at the bottom of the Selector (DESIGN.md §9.18).
 * @returns {{ element: HTMLElement, show: (tools: ToolsInfo) => void }}
 */
export function toolsFooter() {
	const app = h('span', { 'data-app-version': true });
	const ytDlp = h('span', { 'data-tool': 'yt-dlp' });
	const ffmpeg = h('span', { 'data-tool': 'ffmpeg' });
	const element = h('footer', {
		class: 'flex flex-wrap justify-center gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-xs text-muted',
	}, app, ytDlp, ffmpeg);
	let drawn = '';
	return {
		element,
		show: (tools) => {
			const key = JSON.stringify(tools);
			if (key === drawn) {
				return;
			}
			drawn = key;
			app.textContent = `Soundboard ${tools.app}`;
			const update = tools.ytDlp.update;
			const updateText = update === null
				? ''
				: { current: ' · up to date', updated: ' · updated', outdated: ' · update failed', failed: ' · could not check for updates' }[update.state];
			ytDlp.replaceChildren(...toolText('yt-dlp', tools.ytDlp.version, tools.checking, updateText));
			ytDlp.title = update?.error ?? '';
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
		return [`${name}: `, checking ? 'checking…' : h('span', { class: 'text-notice' }, 'not installed, so downloads are off')];
	}
	return [`${name} ${version}${suffix}${checking && name === 'yt-dlp' ? ' · checking for updates…' : ''}`];
}
