import { Component } from './component.js';
import { openContextMenu } from './context-menu.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { soundMenuItems } from './menus.js';
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

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay} options.overlay
	 * @param {AudioFileJson} options.sound
	 * @param {boolean} options.playable
	 */
	constructor({ soundboard, overlay, sound, playable }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#sound = sound;
		this.#playable = playable;
	}

	/** @override */
	render() {
		const { id, title, format } = this.#sound;
		const tile = h('button', {
			'type': 'button',
			'class': `${TILE_CLASS} border-l-sfx pr-10 data-[active=true]:border-sfx data-[active=true]:bg-sfx/15`,
			'title': this.#playable ? title : `${title}: this browser cannot play ${format.toUpperCase()} files`,
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
					}
				});
			},
		}, h('span', { class: 'line-clamp-3 font-medium' }, title));

		const stop = h('button', {
			'type': 'button',
			'class': 'absolute top-2 right-2 grid size-7 cursor-pointer place-items-center rounded-md bg-danger/90 text-white hover:bg-danger',
			'title': 'Stop all',
			'aria-label': `Stop all ${title}`,
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
		this.own(this.#soundboard.on('sound.error', (event) => {
			if (event.soundId === id) {
				flashError(tile);
			}
		}));
		return h('div', { class: 'relative' }, tile, stop);
	}
}
