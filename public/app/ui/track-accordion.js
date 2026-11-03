import { Component } from './component.js';
import { card, moveOrDeleteCard, titleField } from './customize-parts.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { RangeControl } from './range-control.js';
import { GainControl } from './gain-control.js';
import { formatDb } from './gain-scale.js';
import { fromStored, toStoredEnd } from './range-scale.js';
import { t } from './text.js';
import { trackAction, trackPlayback } from './track-playback.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The tracks of a playlist as an accordion (DESIGN.md §9.7): one row per track, at most one open. An open track shows
 * its settings: the start and end points, which turn into a seek bar while the track plays, the volume and the title. Every
 * header has a play / stop button for that track.
 */
export class TrackAccordion extends Component {
	#soundboard;
	#playlist;
	#onEdit;
	#onMove;
	/** @type {string | null} */
	#openId = null;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {PlaylistJson} options.playlist
	 * @param {(trackId: string) => void} options.onEdit called for every change sent for a track
	 * @param {(track: AudioFileJson) => void} options.onMove opens the move dialog for a track
	 */
	constructor({ soundboard, playlist, onEdit, onMove }) {
		super();
		this.#soundboard = soundboard;
		this.#playlist = playlist;
		this.#onEdit = onEdit;
		this.#onMove = onMove;
	}

	/** @override */
	render() {
		/** @type {Map<string, { item: HTMLElement, number: HTMLElement, title: HTMLElement, toggle: HTMLButtonElement,
		 * 	body: HTMLElement, play: HTMLButtonElement, cropped: HTMLElement, volume: HTMLElement, gain: GainControl,
		 * 	range: RangeControl | null, durationMs: number | null, removal: ReturnType<typeof moveOrDeleteCard> }>} */
		const rows = new Map();
		// Tracks can leave while the dialog is open, so a row looks its index up instead of keeping it.
		const indexOf = (/** @type {string} */ trackId) => this.#playlist.tracks.findIndex((track) => track.id === trackId);
		const lastTrackNote = () => (this.#playlist.tracks.length === 1
			? t('customize.lastTrackNote')
			: null);
		const playlistId = this.#playlist.id;
		const list = h('ol', { 'class': 'divide-y divide-line', 'data-track-accordion': true });

		// A waveform is asked for when its row opens, and again when the server has just made it.
		const showWaveform = (/** @type {string} */ trackId) => {
			const range = rows.get(trackId)?.range;
			if (range) {
				void this.#soundboard.getWaveform(trackId).then((peaks) => range.showWaveform(peaks));
			}
		};
		const open = (/** @type {string | null} */ trackId) => {
			this.#openId = trackId;
			if (trackId !== null) {
				showWaveform(trackId);
			}
			for (const [id, row] of rows) {
				const expanded = id === trackId;
				row.toggle.setAttribute('aria-expanded', String(expanded));
				row.body.hidden = !expanded;
			}
		};

		// What the playlist is doing, to keep the rows in step with it and to know which row owns the progress.
		const snapshot = this.#soundboard.getPlaylistSnapshot(playlistId);
		let { state, trackIndex: currentIndex } = snapshot;

		this.#playlist.tracks.forEach((track, index) => {
			const title = h('span', { class: 'min-w-0 flex-1 truncate group-aria-expanded:text-music' }, track.title);
			const play = h('button', {
				'type': 'button',
				'class': 'ml-2 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:text-text data-[playback=playing]:text-music data-[playback=paused]:text-music',
				'data-track-play': track.id,
				'data-playback': 'idle',
				'onClick': () => {
					const index = indexOf(track.id);
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
			const cropped = h('span', {
				'class': 'shrink-0 rounded-full bg-music/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-music',
				'title': t('customize.croppedTooltip'),
				'data-track-cropped': track.id,
				'hidden': !isCropped(track),
			}, t('customize.cropped'));
			const volume = h('span', {
				'class': 'shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold tabular-nums data-[change=louder]:bg-boost/20 data-[change=louder]:text-boost data-[change=quieter]:bg-cyan-400/20 data-[change=quieter]:text-cyan-300',
				'title': t('customize.trackVolumeTooltip'),
				'data-track-volume': track.id,
			});
			showVolume(volume, track);
			const number = h('span', { class: 'w-6 shrink-0 text-right tabular-nums text-muted' }, String(index + 1));
			const toggle = h('button', {
				'type': 'button',
				'class': 'group flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pr-3 pl-2 text-left text-sm',
				'aria-expanded': 'false',
				'data-track-row': track.id,
				'onClick': () => open(this.#openId === track.id ? null : track.id),
			},
			number,
			title,
			cropped,
			volume,
			icon('chevronDown', 'size-4 shrink-0 text-muted transition-transform group-aria-expanded:rotate-180'));

			// The points are chosen over the whole file; a track whose length is unknown has no such control.
			const durationMs = track.duration === null ? null : Math.round(track.duration * 1000);
			const range = durationMs === null
				? null
				: new RangeControl({
						...fromStored(track, durationMs),
						durationMs,
						accent: 'music',
						onChange: (startMs, endMs) => {
							this.#onEdit(track.id);
							this.#soundboard.customizeTrack(track.id, { startAt: startMs / 1000, endAt: toStoredEnd(endMs, durationMs) });
						},
						onSeek: (seconds) => this.#soundboard.seek(playlistId, seconds),
					});
			if (range) {
				this.own(() => range.destroy());
			}
			// The cards' title pills stick out above them, so they need the extra space.
			const body = h('div', { 'class': 'space-y-8 px-4 pt-5 pb-5', 'hidden': true, 'data-track-body': track.id });
			if (range) {
				const slot = h('div');
				range.mount(slot);
				body.append(card(t('customize.startAndEnd'), 'music', slot));
			}
			const gain = new GainControl({
				value: track.gain,
				label: t('customize.trackVolume'),
				onChange: (value) => {
					this.#onEdit(track.id);
					this.#soundboard.customizeTrack(track.id, { gain: value });
				},
			});
			this.own(() => gain.destroy());
			const gainSlot = h('div');
			gain.mount(gainSlot);
			body.append(card(t('customize.volume'), 'music', gainSlot));
			body.append(card(t('customize.trackCard'), 'music', this.#settings(track)));
			const removal = moveOrDeleteCard({
				title: t('customize.moveOrDelete'),
				accent: 'music',
				onMove: () => this.#onMove(track),
				onDelete: () => this.#soundboard.deleteTrack(track.id),
				note: lastTrackNote() ?? undefined,
			});
			this.own(removal.destroy);
			body.append(removal.element);
			const item = h('li', {}, h('div', { class: 'flex items-center hover:bg-music/15 has-[[aria-expanded=true]]:bg-music/20' }, play, toggle), body);
			rows.set(track.id, { item, number, title, toggle, body, play, cropped, volume, gain, range, durationMs, removal });
			list.append(item);
		});

		const showPlayback = () => {
			this.#playlist.tracks.forEach((track, index) => {
				const row = rows.get(track.id);
				if (!row) {
					return;
				}
				const playback = trackPlayback(state, currentIndex, index);
				const label = trackAction(playback) === 'stop' ? t('customize.stop') : t('customize.play');
				row.play.dataset.playback = playback;
				row.play.title = label;
				row.play.setAttribute('aria-label', label);
				row.play.replaceChildren(icon(playback === 'playing' ? 'stop' : 'play', 'size-4'));
				// Only a playing track is a seek bar. A stopped or paused one can be edited; editing a paused track stops it.
				if (playback !== 'playing') {
					row.range?.showPlayback(null);
				}
			});
		};
		/**
		 * Only the playing track's row shows progress.
		 * @param {number} position seconds from the start point
		 * @param {number | null} crossfadeFrom seconds from the start point
		 */
		const showProgress = (position, crossfadeFrom) => {
			if (currentIndex === null || trackPlayback(state, currentIndex, currentIndex) !== 'playing') {
				return;
			}
			rows.get(this.#playlist.tracks[currentIndex]?.id ?? '')?.range?.showPlayback({
				positionMs: position * 1000,
				crossfadeFromMs: crossfadeFrom === null ? null : crossfadeFrom * 1000,
			});
		};
		showPlayback();
		showProgress(snapshot.position, snapshot.crossfadeFrom);
		this.own(this.#soundboard.on('playlist.stateChanged', (event) => {
			if (event.playlistId === playlistId) {
				state = event.state;
				currentIndex = event.trackIndex;
				showPlayback();
				showProgress(this.#soundboard.getPlaylistSnapshot(playlistId).position, event.crossfadeFrom);
			}
		}));
		this.own(this.#soundboard.on('playlist.progress', (event) => {
			if (event.playlistId === playlistId) {
				showProgress(event.position, event.crossfadeFrom);
			}
		}));

		this.own(this.#soundboard.on('waveform.ready', ({ id }) => {
			if (this.#openId === id) {
				showWaveform(id);
			}
		}));

		// Titles change as they are typed; only the row headers follow, so an open title field keeps its focus. The points
		// follow too, unless one is being dragged.
		this.own(this.#soundboard.on('playlist.changed', ({ playlist }) => {
			if (playlist.id === this.#playlist.id) {
				this.#playlist = playlist;
				// A track moved or deleted leaves its row; the others are numbered again, and an only track says so.
				const ids = new Set(playlist.tracks.map((track) => track.id));
				for (const [id, row] of rows) {
					if (!ids.has(id)) {
						row.item.remove();
						rows.delete(id);
						if (this.#openId === id) {
							this.#openId = null;
						}
					}
				}
				playlist.tracks.forEach((track, index) => {
					const row = rows.get(track.id);
					if (row) {
						row.number.textContent = String(index + 1);
						row.removal.showNote(lastTrackNote());
					}
				});
				for (const track of playlist.tracks) {
					const row = rows.get(track.id);
					if (row) {
						row.title.textContent = track.title;
						row.cropped.hidden = !isCropped(track);
						showVolume(row.volume, track);
						row.gain.update(track.gain);
						if (row.range && row.durationMs !== null) {
							row.range.update(fromStored(track, row.durationMs));
						}
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
			hint: t('customize.file', { file: track.id }),
			onTitle: (value) => {
				this.#onEdit(track.id);
				this.#soundboard.customizeTrack(track.id, { title: value });
			},
		}).element;
	}
}

/**
 * Shows how far the track's own volume is from the file's, as a bubble in its header, hidden at 0.0 dB. A rounded
 * value is compared, so the bubble never reads "0.0 dB".
 * @param {HTMLElement} bubble
 * @param {AudioFileJson} track
 */
function showVolume(bubble, track) {
	const text = formatDb(track.gain);
	const same = text === formatDb(1);
	bubble.hidden = same;
	bubble.dataset.change = same ? 'none' : (track.gain > 1 ? 'louder' : 'quieter');
	bubble.textContent = text;
}

/**
 * Whether only part of the file plays.
 * @param {AudioFileJson} track
 */
function isCropped(track) {
	return track.startAt > 0 || track.endAt !== null;
}
