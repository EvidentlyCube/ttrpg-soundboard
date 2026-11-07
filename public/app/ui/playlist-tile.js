import { Component } from './component.js';
import { openContextMenu } from './context-menu.js';
import { h } from './dom.js';
import { formatTime } from './format.js';
import { icon } from './icons.js';
import { playlistMenuItems } from './menus.js';
import { t } from './text.js';
import { TileBackground, showTitleShadow } from './tile-background.js';
import { flashError } from './tile-grid.js';

/**
 * Every playlist tile has the same height, with room for two lines of title (DESIGN.md §9.1). Its colors are on a layer
 * of their own, so they can sit over an image.
 */
const PLAYLIST_TILE_CLASS = 'group relative isolate flex h-28 w-full flex-col items-stretch justify-between gap-2 overflow-hidden rounded-lg '
	+ 'border border-l-4 border-line border-l-music text-left text-text enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 '
	+ 'data-[active=true]:border-music data-[resume=true]:border-dashed data-[error=true]:ring-2 data-[error=true]:ring-danger';
const TILE_COLOR_CLASS = 'bg-raised transition-colors group-enabled:group-hover:bg-raised-hover group-data-[active=true]:bg-raised-music';

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
	#preview;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay | null} options.overlay null only for a preview, which opens no menu
	 * @param {PlaylistJson} options.playlist
	 * @param {boolean} options.playable false when this browser can play none of its tracks
	 * @param {(playlistId: string) => void} [options.onCustomize]
	 * @param {(playlistId: string) => void} [options.onMetadata]
	 * @param {boolean} [options.preview] a copy that only shows the playlist, as the Image tab does: it follows the
	 * 	playlist but never plays it or opens a menu
	 */
	constructor({ soundboard, overlay, playlist, playable, onCustomize = () => {}, onMetadata = () => {}, preview = false }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#playlist = playlist;
		this.#playable = playable;
		this.#onCustomize = onCustomize;
		this.#onMetadata = onMetadata;
		this.#preview = preview;
	}

	/** @override */
	render() {
		const { id, title, tracks } = this.#playlist;
		const trackCount = (/** @type {number} */ count) => t('playlist.trackCount', { count });
		let idleStatus = trackCount(tracks.length);
		let state = this.#soundboard.getPlaylistSnapshot(id).state;
		const background = new TileBackground(TILE_COLOR_CLASS);
		const status = h('span', {
			class: 'block truncate pr-7 text-xs text-muted group-data-[resume=true]:text-music group-data-[image=true]:text-white',
		}, idleStatus);
		const band = h('span', { class: 'relative isolate block w-full px-3 py-1.5' }, background.band(), status);
		let currentTitle = title;
		/** @type {ResumePoint | null} */
		let resume = this.#soundboard.getPlaylistSnapshot(id).resume;
		const tooltip = () => {
			const text = resume ? resumeTooltip(currentTitle, resume) : currentTitle;
			return this.#playable ? text : t('playlist.unplayable', { text });
		};
		const label = h('span', { class: 'line-clamp-2 font-medium wrap-anywhere group-data-[image=true]:text-white' }, title);
		const shadow = h('span', { class: 'block px-3 pt-3' }, label);
		const preview = this.#preview;
		const button = h('button', {
			'type': 'button',
			'class': PLAYLIST_TILE_CLASS,
			'title': tooltip(),
			'disabled': !this.#playable,
			'tabindex': preview ? -1 : undefined,
			'data-playlist-id': preview ? undefined : id,
			'data-active': 'false',
			'data-resume': String(resume !== null),
			'onClick': () => {
				if (!preview) {
					this.#soundboard.togglePlaylist(id);
				}
			},
			'onContextmenu': (/** @type {MouseEvent} */ event) => {
				event.preventDefault();
				if (preview || !this.#overlay) {
					return;
				}
				openContextMenu(
					this.#overlay,
					playlistMenuItems(this.#soundboard.getPlaylistSnapshot(id)),
					{ x: event.clientX, y: event.clientY },
					(item) => this.#runMenuItem(item),
				);
			},
		}, ...background.layers, shadow, band);

		const show = () => {
			button.dataset.active = String(state !== 'idle');
			button.dataset.resume = String(resume !== null);
			button.title = tooltip();
			status.textContent = state !== 'idle' ? t(`playlist.state.${state}`) : resume ? resumeStatus(resume) : idleStatus;
		};
		show();
		/** @param {PlaylistJson} playlist */
		const showImage = (playlist) => {
			const url = playlist.background?.url ?? null;
			button.dataset.image = String(url !== null);
			background.show(url, playlist);
			showTitleShadow(shadow, url === null ? null : playlist);
		};
		showImage(this.#playlist);

		this.own(this.#soundboard.on('playlist.changed', ({ playlist }) => {
			if (playlist.id === id) {
				currentTitle = playlist.title;
				label.textContent = playlist.title;
				// Downloads can add tracks.
				idleStatus = trackCount(playlist.tracks.length);
				show();
				showImage(playlist);
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
		if (preview) {
			return h('div', { class: 'relative' }, button);
		}
		// Shown while the live volume (DESIGN.md §6.4) is turned down, which is set from the player bar. A sibling of the
		// button, so double-clicking it never also toggles the playlist.
		const levelIcon = h('span', {
			'class': 'absolute right-3 bottom-1 grid size-5 place-items-center rounded-full bg-boost text-gray-700',
			'data-level-icon': true,
			'onDblclick': () => this.#soundboard.setPlaylistLevel(id, 1),
		}, icon('volume-high', 'size-4'));
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
