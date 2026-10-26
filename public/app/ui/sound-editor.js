import { Component } from './component.js';
import { h, on } from './dom.js';
import { GainControl } from './gain-control.js';
import { icon } from './icons.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The body of a sound's Customize dialog. Every change goes to the soundboard at once; it applies them immediately
 * and saves them shortly after, and the status line follows those saves.
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

		const status = h('p', { 'class': 'h-5 text-sm text-muted data-[failed=true]:text-danger', 'aria-live': 'polite', 'data-save-status': true });
		const setStatus = (/** @type {string} */ text, failed = false) => {
			status.textContent = text;
			status.dataset.failed = String(failed);
		};

		const title = h('input', {
			'type': 'text',
			'value': this.#sound.title,
			'aria-invalid': 'false',
			'data-sound-title': true,
			'class': 'w-full rounded-md border border-line bg-surface px-3 py-2 outline-none focus:border-music aria-invalid:border-danger',
		});
		const titleHint = h('p', { class: 'text-xs text-muted' }, `File: ${id}`);
		this.own(on(title, 'input', () => {
			const empty = title.value.trim() === '';
			title.setAttribute('aria-invalid', String(empty));
			titleHint.textContent = empty ? 'A title cannot be empty; the last one is kept.' : `File: ${id}`;
			if (!empty) {
				setStatus('Saving…');
				soundboard.customizeSound(id, { title: title.value });
			}
		}));

		const warning = h('p', { class: 'text-sm text-boost', hidden: this.#sound.gain <= 1 }, 'Boosting can distort loud sounds.');
		const gain = new GainControl({
			gain: this.#sound.gain,
			label: 'Volume',
			onChange: (value) => {
				warning.hidden = value <= 1;
				setStatus('Saving…');
				soundboard.customizeSound(id, { gain: value });
			},
		});
		const gainSlot = h('div');
		gain.mount(gainSlot);
		this.own(() => gain.destroy());

		const playIcon = h('span', {}, icon('play', 'size-4'));
		const playLabel = h('span', {}, 'Play');
		const play = h('button', {
			'type': 'button',
			'class': 'flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-raised-hover',
			'data-sound-preview': true,
			'onClick': () => (soundboard.isSoundActive(id) ? soundboard.stopSound(id) : soundboard.playSound(id)),
		}, playIcon, playLabel);
		const showActive = (/** @type {boolean} */ active) => {
			playIcon.replaceChildren(icon(active ? 'stop' : 'play', 'size-4'));
			playLabel.textContent = active ? 'Stop' : 'Play';
		};
		showActive(soundboard.isSoundActive(id));

		this.own(soundboard.on('sound.activeChanged', (event) => {
			if (event.soundId === id) {
				showActive(event.active);
			}
		}));
		this.own(soundboard.on('sound.changed', (event) => {
			if (event.sound.id === id) {
				gain.update(event.sound.gain);
				warning.hidden = event.sound.gain <= 1;
			}
		}));
		this.own(soundboard.on('sound.saved', (event) => {
			if (event.soundId === id) {
				setStatus('Saved');
			}
		}));
		this.own(soundboard.on('sound.saveFailed', (event) => {
			if (event.soundId === id) {
				setStatus(`Could not save: ${event.message}`, true);
			}
		}));

		const label = (/** @type {string} */ text) => h('span', { class: 'text-xs font-semibold uppercase tracking-widest text-muted' }, text);
		return h('div', { class: 'space-y-5' },
			h('label', { class: 'block space-y-1.5' }, label('Title'), title, titleHint),
			h('div', { class: 'space-y-1.5' }, label('Volume'), gainSlot, warning),
			h('div', { class: 'flex items-center justify-between gap-4' }, play, status));
	}

	/** Focuses the title field, for when the dialog opens. */
	focus() {
		/** @type {HTMLInputElement | null} */ (this.element.querySelector('[data-sound-title]'))?.focus();
	}
}
