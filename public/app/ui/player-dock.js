import { Component } from './component.js';
import { h } from './dom.js';
import { PlayerBar } from './player-bar.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./overlay.js').Overlay} Overlay */

/**
 * The footer: one player bar per active playlist, in the order they started, three per row; after two rows it
 * scrolls (DESIGN.md §9.1). Sound effects never appear here. Always visible, so the layout never shifts.
 */
export class PlayerDock extends Component {
	#soundboard;
	#overlay;
	#playlists;
	#isPlayable;
	/** @type {Map<string, PlayerBar>} */
	#bars = new Map();

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay} options.overlay
	 * @param {PlaylistJson[]} options.playlists
	 * @param {(track: AudioFileJson) => boolean} options.isPlayable
	 */
	constructor({ soundboard, overlay, playlists, isPlayable }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#playlists = new Map(playlists.map((playlist) => [playlist.id, playlist]));
		this.#isPlayable = isPlayable;
	}

	/** @override */
	render() {
		// The placeholder is as tall as a bar (h-28), so the footer keeps the height of one row while nothing plays.
		const placeholder = h('div', {
			'class': 'col-span-3 flex h-28 items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted',
			'data-dock-placeholder': true,
		}, 'No playlist playing');
		// Bars are h-28 (7rem): two rows plus the gap and padding is 16.25rem.
		const grid = h('div', { class: 'grid max-h-[16.25rem] grid-cols-3 gap-3 overflow-y-auto p-3' }, placeholder);
		const footer = h('footer', { 'class': 'shrink-0 border-t border-line bg-panel', 'data-player-dock': true }, grid);

		this.own(this.#soundboard.on('playlist.stateChanged', ({ playlistId, state }) => {
			const bar = this.#bars.get(playlistId);
			const playlist = this.#playlists.get(playlistId);
			if (state === 'idle') {
				bar?.destroy();
				this.#bars.delete(playlistId);
			} else if (!bar && playlist) {
				this.#bars.set(playlistId, new PlayerBar({
					soundboard: this.#soundboard,
					overlay: this.#overlay,
					playlist,
					isPlayable: this.#isPlayable,
				}).mount(grid));
			}
			placeholder.hidden = this.#bars.size > 0;
		}));
		// Bars opened later must show the newest title.
		this.own(this.#soundboard.on('playlist.changed', ({ playlist }) => this.#playlists.set(playlist.id, playlist)));
		this.own(this.#soundboard.on('playlist.added', ({ playlist }) => this.#playlists.set(playlist.id, playlist)));
		this.own(() => {
			for (const bar of this.#bars.values()) {
				bar.destroy();
			}
		});
		return footer;
	}
}
