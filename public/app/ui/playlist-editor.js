import { PLAYBACK_ORDERS } from '../logic/order-strategies.js';
import { MAX_CROSSFADE } from '../logic/playback-rules.js';
import { Component } from './component.js';
import { card, checkbox, labeledRow, playToggle, radioGroup, saveStatus, tabs, titleField } from './customize-parts.js';
import { h } from './dom.js';
import { GainControl } from './gain-control.js';
import { SecondsControl } from './seconds-control.js';
import { crossfadeLimits, formatSeconds, SECONDS_LIMITS } from './seconds-scale.js';
import { TrackAccordion } from './track-accordion.js';

/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./seconds-scale.js').SecondsLimits} SecondsLimits */
/** @typedef {'crossfade' | 'fadeIn' | 'fadeOut'} TimingKey */
/** @typedef {import('../logic/order-strategies.js').PlaybackOrder} PlaybackOrder */

/** @type {Record<PlaybackOrder, { label: string, description: string }>} */
const ORDER_CHOICES = {
	ordered: { label: 'Ordered', description: 'First to last, as listed.' },
	random: { label: 'Random', description: 'Any track next, never the same one twice in a row.' },
	shuffle: { label: 'Shuffle', description: 'Every track once in a shuffled order, then shuffled again.' },
};

/**
 * The body of a playlist's Customize dialog (DESIGN.md §9.7). It works like the sound dialog; later playlist settings
 * add their sections here.
 */
export class PlaylistEditor extends Component {
	#soundboard;
	#playlist;
	/** Tracks renamed while the dialog was open, whose saves are flushed when it closes. @type {Set<string>} */
	#editedTracks = new Set();

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
			return { control, element: labeledRow(label, slot) };
		};
		const timings = {
			fadeIn: timing('fadeIn', 'Fade in', SECONDS_LIMITS),
			crossfade: timing('crossfade', 'Crossfade', limits, describeCrossfade),
			fadeOut: timing('fadeOut', 'Fade out', SECONDS_LIMITS),
		};

		const order = radioGroup({
			name: 'playback-order',
			choices: PLAYBACK_ORDERS.map((value) => ({ value, ...ORDER_CHOICES[value] })),
			value: this.#playlist.order,
			accent: 'music',
			onChange: (value) => {
				status.show('saving');
				soundboard.customizePlaylist(id, { order: value });
			},
		});

		const looping = checkbox({
			name: 'track-looping',
			label: 'Repeat the current track',
			description: 'It plays again until you move to another track.',
			checked: this.#playlist.trackLooping,
			accent: 'music',
			onChange: (checked) => {
				status.show('saving');
				soundboard.customizePlaylist(id, { trackLooping: checked });
			},
		});

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
				order.update(event.playlist.order);
				looping.update(event.playlist.trackLooping);
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

		const trackIds = new Set(this.#playlist.tracks.map((track) => track.id));
		const tracks = new TrackAccordion({
			soundboard,
			playlist: this.#playlist,
			onEdit: (trackId) => {
				this.#editedTracks.add(trackId);
				status.show('saving');
			},
		});
		const tracksPanel = h('div');
		tracks.mount(tracksPanel);
		this.own(() => tracks.destroy());
		this.own(soundboard.on('track.saved', (event) => {
			if (trackIds.has(event.trackId)) {
				status.show('saved');
			}
		}));
		this.own(soundboard.on('track.saveFailed', (event) => {
			if (trackIds.has(event.trackId)) {
				status.show('failed', event.message);
			}
		}));

		// The cards' title pills stick out above them, so they need the extra space.
		const settingsPanel = h('div', { class: 'space-y-8 pt-3' },
			card('Playlist', 'music', title.element),
			card('Volume', 'music', gainSlot),
			card('Playback order', 'music', order.element, h('div', { class: 'mt-4 border-t border-line pt-4' }, looping.element)),
			card('Fades', 'music', h('div', { class: 'space-y-3' }, timings.fadeIn.element, timings.crossfade.element, timings.fadeOut.element)));
		const { bar, panels } = tabs([
			{ id: 'playlist', label: 'Playlist', panel: settingsPanel },
			{ id: 'tracks', label: `Tracks (${this.#playlist.tracks.length})`, panel: tracksPanel },
		]);
		return h('div', { class: 'space-y-5' },
			bar,
			...panels,
			// Stays in view on either tab, however long the track list is.
			h('div', { class: 'sticky -bottom-4 -mx-5 -mb-4 flex items-center justify-between gap-4 border-t border-line bg-panel px-5 py-3' },
				play.element, status.element));
	}

	/** Saves at once whatever is still waiting: the playlist's own options and every track renamed in the dialog. */
	flushEdits() {
		this.#soundboard.flushPlaylistOptions(this.#playlist.id);
		for (const trackId of this.#editedTracks) {
			this.#soundboard.flushTrackOptions(trackId);
		}
	}

	/** Focuses the title field, for when the dialog opens. */
	focus() {
		/** @type {HTMLInputElement | null} */ (this.element.querySelector('[data-item-title]'))?.focus();
	}
}
