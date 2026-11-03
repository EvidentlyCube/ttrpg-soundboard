import { Component } from './component.js';
import { openContextMenu } from './context-menu.js';
import { h } from './dom.js';
import { formatTime } from './format.js';
import { icon } from './icons.js';
import { playlistMenuItems } from './menus.js';
import { t } from './text.js';
import { flashError, TILE_CLASS } from './tile-grid.js';

/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/playlist-player.js').PlaylistState} PlaylistState */
/** @typedef {import('../logic/playlist-player.js').ResumePoint} ResumePoint */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./overlay.js').Overlay} Overlay */

/** A playlist button: click toggles it, right-click opens its menu (DESIGN.md §9.1, §9.3). */
export class PlaylistTile extends Component {
	#soundboard;
	#overlay;
	#playlist;
	#playable;
	#onCustomize;
	#onMetadata;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay} options.overlay
	 * @param {PlaylistJson} options.playlist
	 * @param {boolean} options.playable false when this browser can play none of its tracks
	 * @param {(playlistId: string) => void} options.onCustomize
	 * @param {(playlistId: string) => void} options.onMetadata
	 */
	constructor({ soundboard, overlay, playlist, playable, onCustomize, onMetadata }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#playlist = playlist;
		this.#playable = playable;
		this.#onCustomize = onCustomize;
		this.#onMetadata = onMetadata;
	}

	/** @override */
	render() {
		const { id, title, tracks } = this.#playlist;
		const trackCount = (/** @type {number} */ count) => t('playlist.trackCount', { count });
		let idleStatus = trackCount(tracks.length);
		let state = this.#soundboard.getPlaylistSnapshot(id).state;
		const status = h('span', { class: 'max-w-full truncate pr-7 text-xs text-muted group-data-[resume=true]:text-music' }, idleStatus);
		let currentTitle = title;
		/** @type {ResumePoint | null} */
		let resume = this.#soundboard.getPlaylistSnapshot(id).resume;
		const tooltip = () => {
			const text = resume ? resumeTooltip(currentTitle, resume) : currentTitle;
			return this.#playable ? text : t('playlist.unplayable', { text });
		};
		const label = h('span', { class: 'line-clamp-3 font-medium wrap-anywhere' }, title);
		const button = h('button', {
			'type': 'button',
			'class': `${TILE_CLASS} group border-l-music data-[active=true]:border-music data-[active=true]:bg-music/20 data-[resume=true]:border-dashed`,
			'title': tooltip(),
			'disabled': !this.#playable,
			'data-playlist-id': id,
			'data-active': 'false',
			'data-resume': String(resume !== null),
			'onClick': () => this.#soundboard.togglePlaylist(id),
			'onContextmenu': (/** @type {MouseEvent} */ event) => {
				event.preventDefault();
				openContextMenu(
					this.#overlay,
					playlistMenuItems(this.#soundboard.getPlaylistSnapshot(id)),
					{ x: event.clientX, y: event.clientY },
					(item) => this.#runMenuItem(item),
				);
			},
		}, label, status);

		const show = () => {
			button.dataset.active = String(state !== 'idle');
			button.dataset.resume = String(resume !== null);
			button.title = tooltip();
			status.textContent = state !== 'idle' ? t(`playlist.state.${state}`) : resume ? resumeStatus(resume) : idleStatus;
		};
		show();

		this.own(this.#soundboard.on('playlist.changed', ({ playlist }) => {
			if (playlist.id === id) {
				currentTitle = playlist.title;
				label.textContent = playlist.title;
				// Downloads can add tracks.
				idleStatus = trackCount(playlist.tracks.length);
				show();
			}
		}));
		this.own(this.#soundboard.on('playlist.stateChanged', (event) => {
			if (event.playlistId === id) {
				resume = event.resume;
				state = event.state;
				show();
			}
		}));
		this.own(this.#soundboard.on('playlist.error', (event) => {
			if (event.playlistId === id) {
				flashError(button);
			}
		}));
		// Shown while the live volume (DESIGN.md §6.4) is turned down, which is set from the player bar. A sibling of the
		// button, so double-clicking it never also toggles the playlist.
		const levelIcon = h('span', {
			'class': 'absolute right-3 bottom-2.5 grid size-5 place-items-center rounded-full bg-boost text-gray-700',
			'data-level-icon': true,
			'onDblclick': () => this.#soundboard.setPlaylistLevel(id, 1),
		}, icon('volume', 'size-4'));
		const showLevel = (/** @type {number} */ value) => {
			levelIcon.hidden = value >= 1;
			levelIcon.title = t('playlist.levelDown', { percent: Math.round(value * 100) });
		};
		showLevel(this.#soundboard.getPlaylistLevel(id));
		this.own(this.#soundboard.on('playlist.levelChanged', (event) => {
			if (event.playlistId === id) {
				showLevel(event.level);
			}
		}));
		return h('div', { class: 'relative' }, button, levelIcon);
	}

	/** @param {string} item */
	#runMenuItem(item) {
		const id = this.#playlist.id;
		const soundboard = this.#soundboard;
		/** @type {Record<string, () => void>} */
		const actions = {
			play: () => soundboard.playPlaylist(id),
			playInstant: () => soundboard.playPlaylist(id, { transition: 'instant' }),
			next: () => soundboard.nextTrack(id),
			nextInstant: () => soundboard.nextTrack(id, { transition: 'instant' }),
			stop: () => soundboard.stopPlaylist(id),
			stopInstant: () => soundboard.stopPlaylist(id, { transition: 'instant' }),
			reset: () => soundboard.forgetPlaylist(id),
			customize: () => this.#onCustomize(id),
			metadata: () => this.#onMetadata(id),
		};
		actions[item]?.();
	}
}

/**
 * "Resumes at 1:23" or "Resumes track 3".
 * @param {ResumePoint} resume
 */
function resumeStatus({ trackIndex, position }) {
	return position === null
		? t('playlist.resumesTrack', { track: trackIndex + 1 })
		: t('playlist.resumesAt', { time: formatTime(position) });
}

/**
 * The tooltip, which also names the track.
 * @param {string} title
 * @param {ResumePoint} resume
 */
function resumeTooltip(title, { track, position }) {
	return position === null
		? t('playlist.resumesTrackTooltip', { title, track: track.title })
		: t('playlist.resumesAtTooltip', { title, track: track.title, time: formatTime(position) });
}
