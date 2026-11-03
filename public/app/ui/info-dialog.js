import { Component } from './component.js';
import { h } from './dom.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('../logic/ports.js').AppInfo} AppInfo */
/** @typedef {import('../logic/ports.js').YtDlpUpdate} YtDlpUpdate */

/** The body of the Info dialog: the versions of the app, yt-dlp and ffmpeg (DESIGN.md §9.17). */
export class InfoDialog extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const body = h('div', { 'class': 'min-w-80 text-sm', 'data-info': true }, h('p', { class: 'text-muted' }, t('common.loading')));
		this.#soundboard.fetchInfo().then(
			(info) => body.replaceChildren(content(info)),
			() => body.replaceChildren(h('p', { class: 'text-danger' }, t('info.failed'))),
		);
		return body;
	}
}

/**
 * @param {AppInfo} info
 * @returns {HTMLElement}
 */
function content(info) {
	return h('dl', { class: 'grid grid-cols-[auto_1fr] gap-x-6 gap-y-2' },
		...row('app', t('app.name'), info.app),
		...row('yt-dlp', 'yt-dlp', info.ytDlp.version, info.ytDlp.update && updateStatus(info.ytDlp.update)),
		...row('ffmpeg', 'ffmpeg', info.ffmpeg));
}

/**
 * @param {string} id
 * @param {string} name
 * @param {string | null} version null when the program isn't installed
 * @param {HTMLElement | null} [status]
 * @returns {HTMLElement[]}
 */
function row(id, name, version, status = null) {
	return [
		h('dt', { class: 'text-muted' }, name),
		h('dd', { 'class': 'space-y-0.5', 'data-info-row': id },
			version === null
				? h('div', { class: 'text-muted' }, t('info.notInstalled'))
				: h('div', { class: 'font-medium tabular-nums' }, version),
			status),
	];
}

/**
 * @param {YtDlpUpdate} update
 * @returns {HTMLElement}
 */
function updateStatus(update) {
	const attributes = { 'class': 'text-xs text-muted data-[state=outdated]:text-notice', 'data-update-state': update.state };
	switch (update.state) {
		case 'current':
			return h('div', attributes, t('info.upToDate'));
		case 'updated':
			return h('div', attributes, update.current ? t('info.updatedFrom', { version: update.current }) : t('info.updated'));
		case 'outdated':
			return h('div', { ...attributes, title: update.error ?? '' }, t('info.outdated', { version: update.latest ?? '' }));
		case 'failed':
			return h('div', { ...attributes, title: update.error ?? '' }, t('info.checkFailed'));
	}
}
