import { Component } from './component.js';
import { openContextMenu } from './context-menu.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { soundMenuItems } from './menus.js';
import { t } from './text.js';
import { TileBackground, showTitleShadow } from './tile-background.js';
import { flashError } from './tile-grid.js';

/**
 * Every sound tile has the same height, which fits three lines of title (DESIGN.md §9.1). Its colors are on a layer of
 * their own, so they can sit over an image.
 */
const SOUND_TILE_CLASS = 'group relative isolate flex h-24 w-full flex-col items-stretch justify-start overflow-hidden rounded-lg '
	+ 'border border-l-4 border-line border-l-sfx text-left text-text enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 '
	+ 'data-[active=true]:border-sfx data-[error=true]:ring-2 data-[error=true]:ring-danger';
const TILE_COLOR_CLASS = 'bg-raised transition-colors group-enabled:group-hover:bg-raised-hover group-data-[active=true]:bg-raised-sfx';

/** @typedef {import('../logic/ports.js').SoundJson} SoundJson */
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
	#preview;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay | null} options.overlay null only for a preview, which opens no menu
	 * @param {SoundJson} options.sound
	 * @param {boolean} options.playable
	 * @param {(soundId: string) => void} [options.onCustomize]
	 * @param {(soundId: string) => void} [options.onMetadata]
	 * @param {boolean} [options.preview] a copy that only shows the sound, as the Image tab does: it follows the sound
	 * 	but never plays it or opens a menu
	 */
	constructor({ soundboard, overlay, sound, playable, onCustomize = () => {}, onMetadata = () => {}, preview = false }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#sound = sound;
		this.#playable = playable;
		this.#onCustomize = onCustomize;
		this.#onMetadata = onMetadata;
		this.#preview = preview;
	}

	/** @override */
	render() {
		const { id, title, format } = this.#sound;
		const preview = this.#preview;
		const tooltip = (/** @type {string} */ text) => (this.#playable ? text : t('sound.unplayable', { text, format: format.toUpperCase() }));
		const background = new TileBackground(TILE_COLOR_CLASS);
		const label = h('span', { 'class': 'line-clamp-3 font-medium wrap-anywhere group-data-[image=true]:text-white', 'data-tile-title': true }, title);
		// The right padding keeps the title clear of the stop button.
		const shadow = h('span', { class: 'block py-3 pr-10 pl-3' }, label);
		const tile = h('button', {
			'type': 'button',
			'class': SOUND_TILE_CLASS,
			'title': tooltip(title),
			'disabled': !this.#playable,
			'tabindex': preview ? -1 : undefined,
			'data-sound-id': preview ? undefined : id,
			'data-active': 'false',
			'onClick': () => {
				if (!preview) {
					this.#soundboard.playSound(id);
				}
			},
			'onContextmenu': (/** @type {MouseEvent} */ event) => {
				event.preventDefault();
				if (preview || !this.#overlay) {
					return;
				}
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
		}, ...background.layers, shadow);

		/** @param {SoundJson} sound */
		const showImage = (sound) => {
			const url = sound.background?.url ?? null;
			tile.dataset.image = String(url !== null);
			background.show(url, sound);
			showTitleShadow(shadow, url === null ? null : sound);
		};
		showImage(this.#sound);

		const stop = h('button', {
			'type': 'button',
			'class': 'absolute top-2 right-2 grid size-7 cursor-pointer place-items-center rounded-md bg-danger/90 text-white hover:bg-danger',
			'title': t('sound.stopAll'),
			'aria-label': t('sound.stopAllOf', { title }),
			'hidden': true,
			'data-stop-sound': preview ? undefined : id,
			'onClick': () => this.#soundboard.stopSound(id),
		}, icon('stop', 'size-4'));

		this.own(this.#soundboard.on('sound.activeChanged', (event) => {
			if (event.soundId === id) {
				tile.dataset.active = String(event.active);
				stop.hidden = preview || !event.active;
			}
		}));
		this.own(this.#soundboard.on('sound.changed', ({ sound }) => {
			if (sound.id === id) {
				label.textContent = sound.title;
				tile.title = tooltip(sound.title);
				stop.setAttribute('aria-label', t('sound.stopAllOf', { title: sound.title }));
				showImage(sound);
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
