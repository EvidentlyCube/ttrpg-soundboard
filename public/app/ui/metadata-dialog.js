import { Component } from './component.js';
import { card } from './customize-parts.js';
import { h } from './dom.js';
import { sourceRows } from './source-fields.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */

/**
 * Where a sound came from, or every track of a playlist (DESIGN.md §9.13): one raised card per file, with a row per
 * field. Read-only for now; the rows come from `sourceRows`, so an editor can later turn each into a field.
 */
export class MetadataDialog extends Component {
	#soundboard;
	#target;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {{ kind: 'sound' | 'playlist', id: string }} options.target
	 */
	constructor({ soundboard, target }) {
		super();
		this.#soundboard = soundboard;
		this.#target = target;
	}

	/** @override */
	render() {
		const library = this.#soundboard.getLibrary();
		const { kind, id } = this.#target;
		if (kind === 'sound') {
			const sound = library?.sounds.find((entry) => entry.id === id);
			return h('div', { 'data-metadata': 'sound' }, sound ? fileCard('Source', 'sfx', sound) : null);
		}
		const tracks = library?.playlists.find((entry) => entry.id === id)?.tracks ?? [];
		return h('div', { 'class': 'space-y-8 pt-3', 'data-metadata': 'playlist' },
			tracks.map((track, index) => fileCard(`${index + 1}. ${track.title}`, 'music', track)));
	}
}

/**
 * @param {string} title
 * @param {'sfx' | 'music'} accent
 * @param {AudioFileJson} file
 */
function fileCard(title, accent, file) {
	const rows = [
		{ label: 'File', value: file.id, href: null, extra: null },
		...sourceRows(file.source),
	];
	return card(title, accent, h('dl', { 'class': 'grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm', 'data-metadata-file': file.id },
		rows.flatMap(({ label, value, href, extra }) => [
			h('dt', { class: 'text-muted' }, label),
			h('dd', { class: 'flex min-w-0 items-baseline gap-2' }, valueOf(value, href), extra ? link(extra.label, extra.href, 'shrink-0 text-xs') : null),
		])));
}

/**
 * The value, as a link when it has one; "n/a" when it is missing. Long values end in "…" with the full text as a tooltip.
 * @param {string | null} value
 * @param {string | null} href
 */
function valueOf(value, href) {
	if (value === null) {
		return h('span', { class: 'italic text-muted/70' }, 'n/a');
	}
	return href === null
		? h('span', { class: 'truncate select-text', title: value }, value)
		: link(value, href, 'truncate');
}

/**
 * @param {string} text
 * @param {string} href
 * @param {string} className
 */
function link(text, href, className) {
	return h('a', {
		class: `${className} text-music underline decoration-music/40 underline-offset-2 hover:decoration-music`,
		href: href,
		target: '_blank',
		rel: 'noopener noreferrer',
		title: href === text ? text : `${text}\n${href}`,
	}, text);
}
