import { Component } from './component.js';
import { titleField } from './customize-parts.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatTime } from './format.js';
import { progressFraction, seekPosition, trackAction, trackPlayback } from './track-playback.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The tracks of a playlist as an accordion (DESIGN.md §9.7): one row per track, at most one open. An open track shows
 * its settings: a progress bar and the title. Every header has a play / stop button for that track.
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
		/** @type {Map<string, { title: HTMLElement, toggle: HTMLButtonElement, body: HTMLElement, play: HTMLButtonElement,
		 * 	bar: HTMLElement, fill: HTMLElement }>} */
		const rows = new Map();
		const playlistId = this.#playlist.id;
		const list = h('ol', { 'class': 'divide-y divide-line rounded-lg border border-line', 'data-track-accordion': true });

		const open = (/** @type {string | null} */ trackId) => {
			this.#openId = trackId;
			for (const [id, row] of rows) {
				const expanded = id === trackId;
				row.toggle.setAttribute('aria-expanded', String(expanded));
				row.body.hidden = !expanded;
			}
		};

		// What the playlist is doing, to keep the rows in step with it and to know which row owns the progress.
		const snapshot = this.#soundboard.getPlaylistSnapshot(playlistId);
		let { state, trackIndex: currentIndex, duration } = snapshot;

		this.#playlist.tracks.forEach((track, index) => {
			const title = h('span', { class: 'min-w-0 flex-1 truncate' }, track.title);
			const play = h('button', {
				'type': 'button',
				'class': 'ml-2 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-raised-hover hover:text-text data-[playback=playing]:text-music data-[playback=paused]:text-music',
				'data-track-play': track.id,
				'data-playback': 'idle',
				'onClick': () => {
					const action = trackAction(trackPlayback(state, currentIndex, index));
					if (action === 'stop') {
						this.#soundboard.stopPlaylist(playlistId, { transition: 'instant' });
					} else if (action === 'resume') {
						this.#soundboard.resumePlaylist(playlistId);
					} else {
						this.#soundboard.jumpToTrack(playlistId, index, { transition: 'instant' });
					}
				},
			});
			const toggle = h('button', {
				'type': 'button',
				'class': 'group flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pr-3 pl-2 text-left text-sm hover:bg-raised-hover',
				'aria-expanded': 'false',
				'data-track-row': track.id,
				'onClick': () => open(this.#openId === track.id ? null : track.id),
			},
			h('span', { class: 'w-6 shrink-0 text-right tabular-nums text-muted' }, String(index + 1)),
			title,
			h('span', { class: 'shrink-0 tabular-nums text-muted' }, formatTime(track.duration)),
			icon('chevronDown', 'size-4 shrink-0 text-muted transition-transform group-aria-expanded:rotate-180'));

			const fill = h('div', { class: 'h-full rounded-full bg-music', style: { width: '0%' } });
			const bar = h('div', {
				'class': 'flex items-center py-2 data-[enabled=false]:cursor-not-allowed data-[enabled=true]:cursor-pointer',
				'data-track-progress': track.id,
				'data-enabled': 'false',
				'aria-disabled': 'true',
				'title': 'Seek',
				'onPointerdown': (/** @type {PointerEvent} */ event) => {
					if (bar.dataset.enabled !== 'true') {
						return;
					}
					const seconds = seekPosition(event.clientX, bar.getBoundingClientRect(), duration);
					if (seconds !== null) {
						this.#soundboard.seek(playlistId, seconds);
					}
				},
			}, h('div', { class: 'relative h-1.5 w-full rounded-full bg-line' }, fill));
			const body = h('div', { 'class': 'space-y-4 px-3 pt-1 pb-4', 'hidden': true, 'data-track-body': track.id }, bar, this.#settings(track));
			rows.set(track.id, { title, toggle, body, play, bar, fill });
			list.append(h('li', {}, h('div', { class: 'flex items-center' }, play, toggle), body));
		});

		const showPlayback = () => {
			this.#playlist.tracks.forEach((track, index) => {
				const row = rows.get(track.id);
				if (!row) {
					return;
				}
				const playback = trackPlayback(state, currentIndex, index);
				const label = trackAction(playback) === 'stop' ? 'Stop' : 'Play';
				row.play.dataset.playback = playback;
				row.play.title = label;
				row.play.setAttribute('aria-label', label);
				row.play.replaceChildren(icon(playback === 'playing' ? 'stop' : 'play', 'size-4'));
				row.bar.dataset.enabled = String(playback !== 'idle');
				row.bar.setAttribute('aria-disabled', String(playback === 'idle'));
				if (playback === 'idle') {
					row.fill.style.width = '0%';
				}
			});
		};
		showPlayback();
		if (currentIndex !== null) {
			const row = rows.get(this.#playlist.tracks[currentIndex]?.id ?? '');
			if (row) {
				row.fill.style.width = `${progressFraction(snapshot.position, duration) * 100}%`;
			}
		}
		this.own(this.#soundboard.on('playlist.stateChanged', (event) => {
			if (event.playlistId === playlistId) {
				state = event.state;
				currentIndex = event.trackIndex;
				duration = event.duration;
				showPlayback();
			}
		}));
		this.own(this.#soundboard.on('playlist.progress', (event) => {
			if (event.playlistId === playlistId && currentIndex !== null) {
				duration = event.duration;
				const row = rows.get(this.#playlist.tracks[currentIndex]?.id ?? '');
				if (row) {
					row.fill.style.width = `${progressFraction(event.position, event.duration) * 100}%`;
				}
			}
		}));

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
