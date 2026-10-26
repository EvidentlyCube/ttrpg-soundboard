import { Component } from './component.js';
import { CrossfadeControl } from './crossfade-control.js';
import { playToggle, saveStatus, sectionLabel, titleField } from './customize-parts.js';
import { h } from './dom.js';
import { GainControl } from './gain-control.js';

/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The body of a playlist's Customize dialog (DESIGN.md §9.7). It works like the sound dialog; later playlist settings
 * add their sections here.
 */
export class PlaylistEditor extends Component {
	#soundboard;
	#playlist;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {PlaylistJson} options.playlist
	 */
	constructor({ soundboard, playlist }) {
		super();
		this.#soundboard = soundboard;
		this.#playlist = playlist;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const { id } = this.#playlist;

		const status = saveStatus();
		const title = titleField({
			value: this.#playlist.title,
			hint: `Folder: ${id}`,
			onTitle: (value) => {
				status.show('saving');
				soundboard.customizePlaylist(id, { title: value });
			},
		});
		const gain = new GainControl({
			value: this.#playlist.gain,
			label: 'Volume',
			onChange: (value) => {
				status.show('saving');
				soundboard.customizePlaylist(id, { gain: value });
			},
		});
		const gainSlot = h('div');
		gain.mount(gainSlot);
		this.own(() => gain.destroy());

		const crossfade = new CrossfadeControl({
			value: this.#playlist.crossfade,
			tracks: this.#playlist.tracks,
			onChange: (value) => {
				status.show('saving');
				soundboard.customizePlaylist(id, { crossfade: value });
			},
		});
		const crossfadeSlot = h('div');
		crossfade.mount(crossfadeSlot);
		this.own(() => crossfade.destroy());

		const play = playToggle(() => soundboard.togglePlaylist(id));
		play.show(soundboard.getPlaylistSnapshot(id).state !== 'idle');

		this.own(soundboard.on('playlist.stateChanged', (event) => {
			if (event.playlistId === id) {
				play.show(event.state !== 'idle');
			}
		}));
		this.own(soundboard.on('playlist.changed', (event) => {
			if (event.playlist.id === id) {
				gain.update(event.playlist.gain);
				crossfade.update(event.playlist.crossfade);
			}
		}));
		this.own(soundboard.on('playlist.saved', (event) => {
			if (event.playlistId === id) {
				status.show('saved');
			}
		}));
		this.own(soundboard.on('playlist.saveFailed', (event) => {
			if (event.playlistId === id) {
				status.show('failed', event.message);
			}
		}));

		return h('div', { class: 'space-y-5' },
			title.element,
			h('div', { class: 'space-y-1.5' }, sectionLabel('Volume'), gainSlot),
			h('div', { class: 'space-y-1.5' }, sectionLabel('Crossfade'), crossfadeSlot),
			h('div', { class: 'flex items-center justify-between gap-4' }, play.element, status.element));
	}

	/** Focuses the title field, for when the dialog opens. */
	focus() {
		/** @type {HTMLInputElement | null} */ (this.element.querySelector('[data-item-title]'))?.focus();
	}
}
