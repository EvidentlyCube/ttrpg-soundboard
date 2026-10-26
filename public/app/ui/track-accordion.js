import { Component } from './component.js';
import { titleField } from './customize-parts.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatTime } from './format.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The tracks of a playlist as an accordion (DESIGN.md §9.7): one row per track, at most one open. An open track shows
 * its settings; for now only the title.
 */
export class TrackAccordion extends Component {
	#soundboard;
	#playlist;
	#onEdit;
	/** @type {string | null} */
	#openId = null;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {PlaylistJson} options.playlist
	 * @param {(trackId: string) => void} options.onEdit called for every change sent for a track
	 */
	constructor({ soundboard, playlist, onEdit }) {
		super();
		this.#soundboard = soundboard;
		this.#playlist = playlist;
		this.#onEdit = onEdit;
	}

	/** @override */
	render() {
		/** @type {Map<string, { title: HTMLElement, toggle: HTMLButtonElement, body: HTMLElement }>} */
		const rows = new Map();
		const list = h('ol', { 'class': 'divide-y divide-line rounded-lg border border-line', 'data-track-accordion': true });

		const open = (/** @type {string | null} */ trackId) => {
			this.#openId = trackId;
			for (const [id, row] of rows) {
				const expanded = id === trackId;
				row.toggle.setAttribute('aria-expanded', String(expanded));
				row.body.hidden = !expanded;
			}
		};

		this.#playlist.tracks.forEach((track, index) => {
			const title = h('span', { class: 'min-w-0 flex-1 truncate' }, track.title);
			const toggle = h('button', {
				'type': 'button',
				'class': 'group flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-raised-hover',
				'aria-expanded': 'false',
				'data-track-row': track.id,
				'onClick': () => open(this.#openId === track.id ? null : track.id),
			},
			h('span', { class: 'w-6 shrink-0 text-right tabular-nums text-muted' }, String(index + 1)),
			title,
			h('span', { class: 'shrink-0 tabular-nums text-muted' }, formatTime(track.duration)),
			icon('chevronDown', 'size-4 shrink-0 text-muted transition-transform group-aria-expanded:rotate-180'));
			const body = h('div', { 'class': 'space-y-4 px-3 pt-1 pb-4', 'hidden': true, 'data-track-body': track.id }, this.#settings(track));
			rows.set(track.id, { title, toggle, body });
			list.append(h('li', {}, toggle, body));
		});

		// Titles change as they are typed; only the row headers follow, so an open title field keeps its focus.
		this.own(this.#soundboard.on('playlist.changed', ({ playlist }) => {
			if (playlist.id === this.#playlist.id) {
				for (const track of playlist.tracks) {
					const row = rows.get(track.id);
					if (row) {
						row.title.textContent = track.title;
					}
				}
			}
		}));
		return list;
	}

	/** @param {AudioFileJson} track */
	#settings(track) {
		return titleField({
			value: track.title,
			hint: `File: ${track.id}`,
			onTitle: (value) => {
				this.#onEdit(track.id);
				this.#soundboard.customizeTrack(track.id, { title: value });
			},
		}).element;
	}
}
