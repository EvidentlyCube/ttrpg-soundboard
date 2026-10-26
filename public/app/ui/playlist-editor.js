import { MAX_CROSSFADE } from '../logic/playback-rules.js';
import { Component } from './component.js';
import { playToggle, saveStatus, sectionLabel, titleField } from './customize-parts.js';
import { h } from './dom.js';
import { GainControl } from './gain-control.js';
import { SecondsControl } from './seconds-control.js';
import { crossfadeLimits, formatSeconds, SECONDS_LIMITS } from './seconds-scale.js';

/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./seconds-scale.js').SecondsLimits} SecondsLimits */
/** @typedef {'crossfade' | 'fadeIn' | 'fadeOut'} TimingKey */

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

		const limits = crossfadeLimits(this.#playlist.tracks);
		/** @param {number} value */
		const describeCrossfade = (value) => {
			if (value > limits.field) {
				return 'Some tracks are shorter than twice this; they use at most half their length.';
			}
			return limits.field < MAX_CROSSFADE ? `Up to ${formatSeconds(limits.field)}, half the shortest track.` : null;
		};
		/**
		 * @param {TimingKey} key
		 * @param {string} label
		 * @param {SecondsLimits} sectionLimits
		 * @param {(value: number) => string | null} [describe]
		 */
		const timing = (key, label, sectionLimits, describe) => {
			const control = new SecondsControl({
				value: this.#playlist[key],
				name: key,
				label,
				limits: sectionLimits,
				describe,
				onChange: (value) => {
					status.show('saving');
					soundboard.customizePlaylist(id, { [key]: value });
				},
			});
			const slot = h('div');
			control.mount(slot);
			this.own(() => control.destroy());
			return { control, element: h('div', { class: 'space-y-1.5' }, sectionLabel(label), slot) };
		};
		const timings = {
			fadeIn: timing('fadeIn', 'Fade in', SECONDS_LIMITS),
			crossfade: timing('crossfade', 'Crossfade', limits, describeCrossfade),
			fadeOut: timing('fadeOut', 'Fade out', SECONDS_LIMITS),
		};

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
				for (const key of /** @type {TimingKey[]} */ (Object.keys(timings))) {
					timings[key].control.update(event.playlist[key]);
				}
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
			timings.fadeIn.element,
			timings.crossfade.element,
			timings.fadeOut.element,
			h('div', { class: 'flex items-center justify-between gap-4' }, play.element, status.element));
	}

	/** Focuses the title field, for when the dialog opens. */
	focus() {
		/** @type {HTMLInputElement | null} */ (this.element.querySelector('[data-item-title]'))?.focus();
	}
}
