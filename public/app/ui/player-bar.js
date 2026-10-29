import { Component } from './component.js';
import { h } from './dom.js';
import { formatTime } from './format.js';
import { icon } from './icons.js';
import { LevelBar } from './level-bar.js';
import { openTrackList } from './track-list.js';
import { paintWaveform } from './waveform-canvas.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/playlist-player.js').PlaylistSnapshot} PlaylistSnapshot */
/** @typedef {import('../logic/playlist-player.js').PlaylistState} PlaylistState */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./icons.js').IconName} IconName */
/** @typedef {import('./overlay.js').Overlay} Overlay */

const CONTROL_CLASS = 'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-text hover:bg-panel';

/**
 * One active playlist in the footer (DESIGN.md §9.2): track, transport controls, time and a seekable progress bar.
 * Time and progress change several times a second, so they only ever touch text and inline styles.
 */
export class PlayerBar extends Component {
	#soundboard;
	#overlay;
	#playlist;
	#isPlayable;
	/** @type {number | null} */
	#duration = null;
	#position = 0;
	/** @type {number | null} */
	#trackIndex = null;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay} options.overlay
	 * @param {PlaylistJson} options.playlist
	 * @param {(track: AudioFileJson) => boolean} options.isPlayable
	 */
	constructor({ soundboard, overlay, playlist, isPlayable }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#playlist = playlist;
		this.#isPlayable = isPlayable;
	}

	/** @override */
	render() {
		const { id, title } = this.#playlist;
		const soundboard = this.#soundboard;

		const time = h('span', { class: 'shrink-0 text-xs tabular-nums text-muted' });
		const trackTitle = h('span', { class: 'truncate' });
		const trackButton = h('button', {
			type: 'button',
			class: 'flex min-w-0 max-w-full cursor-pointer items-center gap-1 text-left font-medium hover:text-music',
			title: 'Choose a track',
			onClick: () => {
				const rect = trackButton.getBoundingClientRect();
				openTrackList(this.#overlay, {
					tracks: this.#playlist.tracks,
					currentIndex: this.#trackIndex,
					isPlayable: this.#isPlayable,
					point: { x: rect.left, y: rect.bottom },
					onSelect: (index) => soundboard.jumpToTrack(id, index),
				});
			},
		}, trackTitle, icon('chevronDown', 'size-4 shrink-0 text-muted'));

		const playIcon = icon('play');
		const pauseIcon = icon('pause');
		const playPause = this.#control('Pause', [playIcon, pauseIcon], () => {
			if (soundboard.getPlaylistSnapshot(id).state === 'paused') {
				soundboard.resumePlaylist(id);
			} else {
				soundboard.pausePlaylist(id);
			}
		});

		const fill = h('div', { class: 'absolute inset-y-0 left-0 rounded-full bg-music transition-[width] duration-200 ease-linear', style: { width: '0%' } });
		// Where the crossfade into the next track will happen; the fill passes over it as the track plays.
		const crossfadeBand = h('div', {
			'class': 'absolute inset-y-0 right-0 rounded-r-full bg-music/40',
			'title': 'Crossfade into the next track',
			'hidden': true,
			'data-crossfade-band': true,
		});
		const wave = h('canvas', { class: 'pointer-events-none absolute inset-0 size-full text-music/35' });
		const progress = h('div', {
			'class': 'relative flex h-8 flex-1 cursor-pointer items-center',
			'title': 'Seek',
			'data-progress': true,
			'onPointerdown': (/** @type {PointerEvent} */ event) => {
				const rect = progress.getBoundingClientRect();
				if (this.#duration !== null && rect.width > 0) {
					soundboard.seek(id, ((event.clientX - rect.left) / rect.width) * this.#duration);
				}
			},
		}, wave, h('div', { class: 'relative h-0.5 w-full rounded-full bg-line/70' }, crossfadeBand, fill));

		// The waveform of the part of the file that plays, behind the progress bar. It is the whole file's waveform cut at
		// the track's points, so the bar's width means the same thing as before.
		/** @type {AudioFileJson | null} */
		let waveTrack = null;
		/** @type {Int8Array | null} */
		let wavePeaks = null;
		const drawWave = () => {
			const track = waveTrack;
			if (!track || !wavePeaks) {
				wave.getContext('2d')?.clearRect(0, 0, wave.width, wave.height);
				return;
			}
			const buckets = wavePeaks.length / 2;
			const total = track.duration ?? 0;
			const from = total > 0 ? Math.floor((track.startAt / total) * buckets) : 0;
			const to = total > 0 && track.endAt !== null ? Math.ceil((track.endAt / total) * buckets) : buckets;
			paintWaveform(wave, wavePeaks.subarray(from * 2, Math.max(from + 1, to) * 2));
		};
		const loadWave = (/** @type {AudioFileJson | null} */ track) => {
			if (track?.id === waveTrack?.id && track?.startAt === waveTrack?.startAt && track?.endAt === waveTrack?.endAt) {
				return;
			}
			waveTrack = track;
			wavePeaks = null;
			drawWave();
			if (track) {
				void soundboard.getWaveform(track.id).then((peaks) => {
					if (waveTrack === track) {
						wavePeaks = peaks;
						drawWave();
					}
				});
			}
		};
		const resizes = new ResizeObserver(drawWave);
		resizes.observe(wave);
		this.own(() => resizes.disconnect());
		this.own(soundboard.on('waveform.ready', ({ id }) => {
			if (waveTrack?.id === id) {
				const track = waveTrack;
				waveTrack = null;
				loadWave(track);
			}
		}));

		const playlistTitle = h('span', { class: 'truncate text-xs font-semibold uppercase tracking-wide text-music' }, title);
		this.own(soundboard.on('playlist.changed', ({ playlist }) => {
			if (playlist.id === id) {
				// Kept for the track list popover, which shows the newest track titles.
				this.#playlist = playlist;
				playlistTitle.textContent = playlist.title;
			}
		}));

		// Pushed to the right by the title, which takes the free space; the same value as the playlist tile's bar.
		const levelHolder = h('div', { class: 'ml-auto shrink-0' });
		const levelBar = new LevelBar({ soundboard, playlistId: id }).mount(levelHolder);
		this.own(() => levelBar.destroy());

		const root = h('div', { 'class': 'flex h-28 flex-col justify-between rounded-lg border border-line bg-raised p-3', 'data-player-bar': id },
			h('div', { class: 'flex items-center justify-between gap-2' }, playlistTitle, levelHolder, time),
			trackButton,
			h('div', { class: 'flex items-center gap-1' },
				this.#control('Previous', [icon('previous')], () => soundboard.previousTrack(id)),
				playPause,
				this.#control('Next', [icon('next')], () => soundboard.nextTrack(id)),
				this.#control('Stop', [icon('stop')], () => soundboard.stopPlaylist(id)),
				progress));

		/** @param {number} position */
		const showProgress = (position) => {
			this.#position = position;
			time.textContent = `${formatTime(position)} / ${formatTime(this.#duration)}`;
			fill.style.width = this.#duration ? `${Math.min(100, (position / this.#duration) * 100)}%` : '0%';
		};
		/** @param {number | null} crossfadeFrom */
		const showCrossfade = (crossfadeFrom) => {
			const duration = this.#duration;
			crossfadeBand.hidden = crossfadeFrom === null || !duration;
			if (crossfadeFrom !== null && duration) {
				crossfadeBand.style.width = `${Math.max(0, 100 - (crossfadeFrom / duration) * 100)}%`;
			}
		};
		/**
		 * @param {{ state: PlaylistState, track: AudioFileJson | null, trackIndex: number | null, duration: number | null,
		 * 	crossfadeFrom: number | null }} state
		 */
		const showState = ({ state, track, trackIndex, duration, crossfadeFrom }) => {
			if (trackIndex !== this.#trackIndex) {
				this.#position = 0;
			}
			this.#trackIndex = trackIndex;
			this.#duration = duration;
			trackTitle.textContent = track?.title ?? '';
			loadWave(track);
			const paused = state === 'paused';
			playIcon.style.display = paused ? '' : 'none';
			pauseIcon.style.display = paused ? 'none' : '';
			playPause.title = paused ? 'Resume' : 'Pause';
			playPause.setAttribute('aria-label', playPause.title);
			showProgress(this.#position);
			showCrossfade(crossfadeFrom);
		};

		const snapshot = soundboard.getPlaylistSnapshot(id);
		this.#position = snapshot.position;
		showState(snapshot);
		this.own(soundboard.on('playlist.stateChanged', (event) => {
			if (event.playlistId === id) {
				showState(event);
			}
		}));
		this.own(soundboard.on('playlist.progress', (event) => {
			if (event.playlistId === id) {
				this.#duration = event.duration;
				showProgress(event.position);
				showCrossfade(event.crossfadeFrom);
			}
		}));
		return root;
	}

	/**
	 * @param {string} label
	 * @param {SVGSVGElement[]} icons
	 * @param {() => void} onClick
	 */
	#control(label, icons, onClick) {
		return h('button', { 'type': 'button', 'class': CONTROL_CLASS, 'title': label, 'aria-label': label, 'data-control': label.toLowerCase(), onClick }, icons);
	}
}
