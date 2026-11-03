import { Component } from './component.js';
import { openContextMenu } from './context-menu.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { soundMenuItems } from './menus.js';
import { t } from './text.js';
import { flashError, TILE_CLASS } from './tile-grid.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./overlay.js').Overlay} Overlay */

/**
 * A sound effect button. Every click starts another instance; while any play, a stop button appears in the corner
 * (DESIGN.md §9.1). The stop button is a sibling, not a child, so pressing it never also plays the sound.
 */
export class SoundTile extends Component {
	#soundboard;
	#overlay;
	#sound;
	#playable;
	#onCustomize;
	#onMetadata;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay} options.overlay
	 * @param {AudioFileJson} options.sound
	 * @param {boolean} options.playable
	 * @param {(soundId: string) => void} options.onCustomize
	 * @param {(soundId: string) => void} options.onMetadata
	 */
	constructor({ soundboard, overlay, sound, playable, onCustomize, onMetadata }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#sound = sound;
		this.#playable = playable;
		this.#onCustomize = onCustomize;
		this.#onMetadata = onMetadata;
	}

	/** @override */
	render() {
		const { id, title, format } = this.#sound;
		const tooltip = (/** @type {string} */ text) => (this.#playable ? text : t('sound.unplayable', { text, format: format.toUpperCase() }));
		const label = h('span', { class: 'line-clamp-3 font-medium wrap-anywhere' }, title);
		const tile = h('button', {
			'type': 'button',
			'class': `${TILE_CLASS} border-l-sfx pr-10 data-[active=true]:border-sfx data-[active=true]:bg-sfx/15`,
			'title': tooltip(title),
			'disabled': !this.#playable,
			'data-sound-id': id,
			'data-active': 'false',
			'onClick': () => this.#soundboard.playSound(id),
			'onContextmenu': (/** @type {MouseEvent} */ event) => {
				event.preventDefault();
				openContextMenu(this.#overlay, soundMenuItems(this.#soundboard.isSoundActive(id)), { x: event.clientX, y: event.clientY }, (item) => {
					if (item === 'play') {
						this.#soundboard.playSound(id);
					} else if (item === 'stopAll') {
						this.#soundboard.stopSound(id);
					} else if (item === 'customize') {
						this.#onCustomize(id);
					} else if (item === 'metadata') {
						this.#onMetadata(id);
					}
				});
			},
		}, label);

		const stop = h('button', {
			'type': 'button',
			'class': 'absolute top-2 right-2 grid size-7 cursor-pointer place-items-center rounded-md bg-danger/90 text-white hover:bg-danger',
			'title': t('sound.stopAll'),
			'aria-label': t('sound.stopAllOf', { title }),
			'hidden': true,
			'data-stop-sound': id,
			'onClick': () => this.#soundboard.stopSound(id),
		}, icon('stop', 'size-4'));

		this.own(this.#soundboard.on('sound.activeChanged', (event) => {
			if (event.soundId === id) {
				tile.dataset.active = String(event.active);
				stop.hidden = !event.active;
			}
		}));
		this.own(this.#soundboard.on('sound.changed', ({ sound }) => {
			if (sound.id === id) {
				label.textContent = sound.title;
				tile.title = tooltip(sound.title);
				stop.setAttribute('aria-label', t('sound.stopAllOf', { title: sound.title }));
			}
		}));
		this.own(this.#soundboard.on('sound.error', (event) => {
			if (event.soundId === id) {
				flashError(tile);
			}
		}));
		return h('div', { class: 'relative' }, tile, stop);
	}
}
