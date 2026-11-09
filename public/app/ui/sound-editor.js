import { Component } from './component.js';
import { BackgroundEditor } from './background-editor.js';
import { card, labeledRow, moveOrDeleteCard, playFooter, playToggle, saveStatus, tabs, titleField } from './customize-parts.js';
import { h } from './dom.js';
import { GainControl } from './gain-control.js';
import { RangeControl } from './range-control.js';
import { fromStored, toStoredEnd } from './range-scale.js';
import { SecondsControl } from './seconds-control.js';
import { SECONDS_LIMITS } from './seconds-scale.js';
import { SoundTile } from './sound-tile.js';
import { t } from './text.js';

/** @typedef {import('../logic/ports.js').SoundJson} SoundJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The body of a sound's Customize dialog. Every change goes to the soundboard at once; it applies them immediately
 * and saves them shortly after, and the save status follows those saves.
 */
export class SoundEditor extends Component {
	#soundboard;
	#sound;
	#onMove;
	/** @type {HTMLElement | null} */
	#footer = null;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {SoundJson} options.sound
	 * @param {() => void} options.onMove opens the move dialog for this sound
	 */
	constructor({ soundboard, sound, onMove }) {
		super();
		this.#soundboard = soundboard;
		this.#sound = sound;
		this.#onMove = onMove;
	}

	/** Play and the save status, which the dialog keeps below the scrolling body. */
	get footer() {
		if (!this.#footer) {
			throw new Error('SoundEditor is not mounted');
		}
		return this.#footer;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const { id } = this.#sound;

		const status = saveStatus();
		const title = titleField({
			value: this.#sound.title,
			hint: t('customize.file', { file: id }),
			accent: 'sfx',
			onTitle: (value) => {
				status.show('saving');
				soundboard.customizeSound(id, { title: value });
			},
		});
		const gain = new GainControl({
			value: this.#sound.gain,
			label: t('customize.volume'),
			accent: 'sfx',
			onChange: (value) => {
				status.show('saving');
				soundboard.customizeSound(id, { gain: value });
			},
		});
		const gainSlot = h('div');
		gain.mount(gainSlot);
		this.own(() => gain.destroy());

		const { duration } = this.#sound;
		// Every sound should have a measured duration; until that is guaranteed, one without leaves the range out (ROADMAP.md).
		const durationMs = duration === null ? null : Math.round(duration * 1000);
		/** @type {RangeControl | null} */
		let range = null;
		const rangeSlot = h('div');
		if (durationMs !== null) {
			const control = new RangeControl({
				...fromStored(this.#sound, durationMs),
				durationMs,
				fadeInMs: this.#sound.fadeIn * 1000,
				fadeOutMs: this.#sound.fadeOut * 1000,
				onChange: (startMs, endMs) => {
					status.show('saving');
					soundboard.customizeSound(id, { startAt: startMs / 1000, endAt: toStoredEnd(endMs, durationMs) });
				},
			});
			control.mount(rangeSlot);
			this.own(() => control.destroy());
			range = control;
		}

		const showWaveform = () => {
			void soundboard.getWaveform(id).then((peaks) => range?.showWaveform(peaks));
		};
		if (range) {
			showWaveform();
		}
		this.own(soundboard.on('waveform.ready', (event) => {
			if (event.id === id) {
				showWaveform();
			}
		}));

		/**
		 * @param {'fadeIn' | 'fadeOut'} key
		 * @param {string} label
		 */
		const fade = (key, label) => {
			const control = new SecondsControl({
				value: this.#sound[key],
				name: key,
				label,
				limits: SECONDS_LIMITS,
				accent: 'sfx',
				onChange: (value) => {
					status.show('saving');
					soundboard.customizeSound(id, { [key]: value });
				},
			});
			const slot = h('div');
			control.mount(slot);
			this.own(() => control.destroy());
			return { control, element: labeledRow(label, slot) };
		};
		const fades = { fadeIn: fade('fadeIn', t('customize.fadeIn')), fadeOut: fade('fadeOut', t('customize.fadeOut')) };

		const play = playToggle(() => (soundboard.isSoundActive(id) ? soundboard.stopSound(id) : soundboard.playSound(id)), 'sfx');
		play.show(soundboard.isSoundActive(id));

		this.own(soundboard.on('sound.activeChanged', (event) => {
			if (event.soundId === id) {
				play.show(event.active);
			}
		}));
		this.own(soundboard.on('sound.changed', (event) => {
			if (event.sound.id === id) {
				gain.update(event.sound.gain);
				if (range && durationMs !== null) {
					range.update(fromStored(event.sound, durationMs));
					range.showFades(event.sound.fadeIn * 1000, event.sound.fadeOut * 1000);
				}
				fades.fadeIn.control.update(event.sound.fadeIn);
				fades.fadeOut.control.update(event.sound.fadeOut);
			}
		}));
		this.own(soundboard.on('sound.saved', (event) => {
			if (event.soundId === id) {
				status.show('saved');
			}
		}));
		this.own(soundboard.on('sound.saveFailed', (event) => {
			if (event.soundId === id) {
				status.show('failed', event.message);
			}
		}));

		const removal = moveOrDeleteCard({
			title: t('customize.moveOrDelete'),
			accent: 'sfx',
			onMove: this.#onMove,
			onDelete: () => soundboard.deleteSound(id),
		});
		this.own(removal.destroy);

		// The cards' title pills stick out above them, so they need the extra space.
		const settingsPanel = h('div', { class: 'space-y-8 pt-3' },
			card(t('customize.soundCard'), 'sfx', title.element),
			card(t('customize.volume'), 'sfx', gainSlot),
			range && card(t('customize.startAndEnd'), 'sfx', rangeSlot),
			card(t('customize.fades'), 'sfx', h('div', { class: 'space-y-3' }, fades.fadeIn.element, fades.fadeOut.element)),
			removal.element);

		const preview = new SoundTile({ soundboard, overlay: null, sound: this.#sound, playable: true, preview: true });
		const previewSlot = h('div');
		preview.mount(previewSlot);
		this.own(() => preview.destroy());
		const image = new BackgroundEditor({
			item: this.#sound,
			preview: previewSlot,
			accent: 'sfx',
			onStyle: (changes) => {
				status.show('saving');
				soundboard.customizeSound(id, changes);
			},
			onUpload: async (file) => soundboard.uploadSoundBackground(id, await file.arrayBuffer(), file.type),
			onDownload: (url) => soundboard.downloadSoundBackground(id, url),
			onRemove: () => soundboard.removeSoundBackground(id),
		});
		const imagePanel = h('div');
		image.mount(imagePanel);
		this.own(() => image.destroy());
		this.own(soundboard.on('sound.changed', (event) => {
			if (event.sound.id === id) {
				image.update(event.sound);
			}
		}));

		const { bar, panels } = tabs([
			{ id: 'sound', label: t('customize.soundTab'), panel: settingsPanel },
			{ id: 'image', label: t('customize.imageTab'), panel: imagePanel },
		]);
		this.#footer = playFooter(play.element, status.element);
		return h('div', { class: 'space-y-5' }, bar, ...panels);
	}

	/** Focuses the title field, for when the dialog opens. */
	focus() {
		/** @type {HTMLInputElement | null} */ (this.element.querySelector('[data-item-title]'))?.focus();
	}
}
