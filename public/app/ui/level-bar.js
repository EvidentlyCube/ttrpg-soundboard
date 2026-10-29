import { Component } from './component.js';
import { GainControl } from './gain-control.js';
import { BUS_SCALE } from './gain-scale.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * A playlist's small live volume bar (DESIGN.md §6.4): a thin line, without the bars of the header volumes. Every bar of
 * one playlist shows the same value: they all follow `playlist.levelChanged`, so the tile's bar and the footer's stay in
 * step.
 */
export class LevelBar extends Component {
	#soundboard;
	#playlistId;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {string} options.playlistId
	 */
	constructor({ soundboard, playlistId }) {
		super();
		this.#soundboard = soundboard;
		this.#playlistId = playlistId;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const id = this.#playlistId;
		const control = new GainControl({
			value: soundboard.getPlaylistLevel(id),
			scale: BUS_SCALE,
			label: 'Live volume',
			mini: true,
			onChange: (value) => soundboard.setPlaylistLevel(id, value),
		});
		const root = document.createElement('div');
		root.dataset.levelBar = id;
		control.mount(root);
		this.own(() => control.destroy());
		this.own(soundboard.on('playlist.levelChanged', (event) => {
			if (event.playlistId === id) {
				control.update(event.level);
			}
		}));
		return root;
	}
}
