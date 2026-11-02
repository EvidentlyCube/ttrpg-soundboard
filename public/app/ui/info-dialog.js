import { Component } from './component.js';
import { h } from './dom.js';

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
		const body = h('div', { 'class': 'min-w-80 text-sm', 'data-info': true }, h('p', { class: 'text-muted' }, 'Loading…'));
		this.#soundboard.fetchInfo().then(
			(info) => body.replaceChildren(content(info)),
			() => body.replaceChildren(h('p', { class: 'text-danger' }, 'Could not get the versions from the server.')),
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
		...row('app', 'Soundboard', info.app),
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
				? h('div', { class: 'text-muted' }, 'Not installed')
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
			return h('div', attributes, 'Up to date');
		case 'updated':
			return h('div', attributes, `Updated at startup${update.current ? ` from ${update.current}` : ''}`);
		case 'outdated':
			return h('div', { ...attributes, title: update.error ?? '' }, `${update.latest} available, but the update failed`);
		case 'failed':
			return h('div', { ...attributes, title: update.error ?? '' }, 'Could not check for updates');
	}
}
