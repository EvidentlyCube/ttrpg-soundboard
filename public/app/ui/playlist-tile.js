import { Component } from './component.js';
import { openContextMenu } from './context-menu.js';
import { h } from './dom.js';
import { playlistMenuItems } from './menus.js';
import { flashError, TILE_CLASS } from './tile-grid.js';

/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/playlist-player.js').PlaylistState} PlaylistState */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./overlay.js').Overlay} Overlay */

/** @type {Record<PlaylistState, string>} */
const STATUS = { idle: '', loading: 'Loading…', playing: 'Playing', paused: 'Paused' };

/** A playlist button: click toggles it, right-click opens its menu (DESIGN.md §9.1, §9.3). */
export class PlaylistTile extends Component {
	#soundboard;
	#overlay;
	#playlist;
	#playable;
	#onCustomize;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay} options.overlay
	 * @param {PlaylistJson} options.playlist
	 * @param {boolean} options.playable false when this browser can play none of its tracks
	 * @param {(playlistId: string) => void} options.onCustomize
	 */
	constructor({ soundboard, overlay, playlist, playable, onCustomize }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#playlist = playlist;
		this.#playable = playable;
		this.#onCustomize = onCustomize;
	}

	/** @override */
	render() {
		const { id, title, tracks } = this.#playlist;
		const idleStatus = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`;
		const status = h('span', { class: 'text-xs text-muted' }, idleStatus);
		const tooltip = (/** @type {string} */ text) => (this.#playable ? text : `${text}: this browser cannot play any of its tracks`);
		const label = h('span', { class: 'line-clamp-3 font-medium' }, title);
		const button = h('button', {
			'type': 'button',
			'class': `${TILE_CLASS} border-l-music data-[active=true]:border-music data-[active=true]:bg-music/20`,
			'title': tooltip(title),
			'disabled': !this.#playable,
			'data-playlist-id': id,
			'data-active': 'false',
			'onClick': () => this.#soundboard.togglePlaylist(id),
			'onContextmenu': (/** @type {MouseEvent} */ event) => {
				event.preventDefault();
				openContextMenu(
					this.#overlay,
					playlistMenuItems(this.#soundboard.getPlaylistSnapshot(id).state),
					{ x: event.clientX, y: event.clientY },
					(item) => this.#runMenuItem(item),
				);
			},
		}, label, status);

		this.own(this.#soundboard.on('playlist.changed', ({ playlist }) => {
			if (playlist.id === id) {
				label.textContent = playlist.title;
				button.title = tooltip(playlist.title);
			}
		}));
		this.own(this.#soundboard.on('playlist.stateChanged', (event) => {
			if (event.playlistId === id) {
				button.dataset.active = String(event.state !== 'idle');
				status.textContent = STATUS[event.state] || idleStatus;
			}
		}));
		this.own(this.#soundboard.on('playlist.error', (event) => {
			if (event.playlistId === id) {
				flashError(button);
			}
		}));
		return button;
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
			customize: () => this.#onCustomize(id),
		};
		actions[item]?.();
	}
}
