import { Component } from './component.js';
import { playToggle, saveStatus, sectionLabel, titleField } from './customize-parts.js';
import { h } from './dom.js';
import { GainControl } from './gain-control.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The body of a sound's Customize dialog. Every change goes to the soundboard at once; it applies them immediately
 * and saves them shortly after, and the save status follows those saves.
 */
export class SoundEditor extends Component {
	#soundboard;
	#sound;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {AudioFileJson} options.sound
	 */
	constructor({ soundboard, sound }) {
		super();
		this.#soundboard = soundboard;
		this.#sound = sound;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const { id } = this.#sound;

		const status = saveStatus();
		const title = titleField({
			value: this.#sound.title,
			hint: `File: ${id}`,
			onTitle: (value) => {
				status.show('saving');
				soundboard.customizeSound(id, { title: value });
			},
		});
		const gain = new GainControl({
			value: this.#sound.gain,
			label: 'Volume',
			onChange: (value) => {
				status.show('saving');
				soundboard.customizeSound(id, { gain: value });
			},
		});
		const gainSlot = h('div');
		gain.mount(gainSlot);
		this.own(() => gain.destroy());

		const play = playToggle(() => (soundboard.isSoundActive(id) ? soundboard.stopSound(id) : soundboard.playSound(id)));
		play.show(soundboard.isSoundActive(id));

		this.own(soundboard.on('sound.activeChanged', (event) => {
			if (event.soundId === id) {
				play.show(event.active);
			}
		}));
		this.own(soundboard.on('sound.changed', (event) => {
			if (event.sound.id === id) {
				gain.update(event.sound.gain);
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

		return h('div', { class: 'space-y-5' },
			title.element,
			h('div', { class: 'space-y-1.5' }, sectionLabel('Volume'), gainSlot),
			h('div', { class: 'flex items-center justify-between gap-4' }, play.element, status.element));
	}

	/** Focuses the title field, for when the dialog opens. */
	focus() {
		/** @type {HTMLInputElement | null} */ (this.element.querySelector('[data-item-title]'))?.focus();
	}
}
