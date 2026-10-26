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

		const status = h('div', { 'class': 'flex h-5 items-center gap-2 text-sm text-danger', 'role': 'status', 'data-save-status': true });
		/** @param {'saving' | 'saved' | 'failed'} state */
		const setStatus = (state, message = '') => {
			status.dataset.state = state;
			if (state === 'failed') {
				status.replaceChildren(`Could not save: ${message}`);
				status.removeAttribute('aria-label');
				return;
			}
			status.replaceChildren(state === 'saving'
				? icon('spinner', 'size-5 animate-spin text-muted')
				: icon('check', 'size-5 text-emerald-400'));
			status.setAttribute('aria-label', state === 'saving' ? 'Saving' : 'Saved');
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
				setStatus('saving');
				soundboard.customizeSound(id, { title: title.value });
			}
		}));

		const gain = new GainControl({
			value: this.#sound.gain,
			label: 'Volume',
			onChange: (value) => {
				setStatus('saving');
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
			}
		}));
		this.own(soundboard.on('sound.saved', (event) => {
			if (event.soundId === id) {
				setStatus('saved');
			}
		}));
		this.own(soundboard.on('sound.saveFailed', (event) => {
			if (event.soundId === id) {
				setStatus('failed', event.message);
			}
		}));

		const label = (/** @type {string} */ text) => h('span', { class: 'text-xs font-semibold uppercase tracking-widest text-muted' }, text);
		return h('div', { class: 'space-y-5' },
			h('label', { class: 'block space-y-1.5' }, label('Title'), title, titleHint),
			h('div', { class: 'space-y-1.5' }, label('Volume'), gainSlot),
			h('div', { class: 'flex items-center justify-between gap-4' }, play, status));
	}

	/** Focuses the title field, for when the dialog opens. */
	focus() {
		/** @type {HTMLInputElement | null} */ (this.element.querySelector('[data-sound-title]'))?.focus();
	}
}
