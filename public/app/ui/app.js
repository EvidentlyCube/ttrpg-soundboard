import { Component } from './component.js';
import { h, on } from './dom.js';
import { Overlay } from './overlay.js';
import { PlayerDock } from './player-dock.js';
import { PlaylistTile } from './playlist-tile.js';
import { SoundTile } from './sound-tile.js';
import { Splash } from './splash.js';
import { tileGrid } from './tile-grid.js';
import { VolumeControls } from './volume-controls.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/ports.js').LibraryJson} LibraryJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** @typedef {'start' | 'loading' | 'failed' | 'ready' | 'suspended'} AppPhase */

/** The whole page: the splash until the soundboard is ready, then the board (DESIGN.md §9). */
export class App extends Component {
	#soundboard;
	#overlay = new Overlay();
	/** @type {AppPhase} */
	#phase = 'start';
	/** @type {Splash | null} */
	#splash = null;
	/** @type {Board | null} */
	#board = null;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const root = h('div', { class: 'h-full' });
		const splash = new Splash(() => this.#onSplashClick()).mount(root);
		splash.show('Click anywhere to start');
		this.#splash = splash;

		// Safari can suspend audio at any time; resuming is only allowed inside a gesture, so every press tries.
		this.own(on(document, 'pointerdown', () => soundboard.unlockAudio(), { capture: true }));
		this.own(soundboard.on('app.ready', ({ library, unplayable }) => {
			this.#phase = 'ready';
			splash.hide();
			this.#board = new Board({ soundboard, overlay: this.#overlay, library, unplayable: new Set(unplayable) }).mount(root);
		}));
		this.own(soundboard.on('app.startFailed', ({ message }) => {
			this.#phase = 'failed';
			splash.show('Could not start the soundboard. Click to retry.', message);
		}));
		this.own(soundboard.on('audio.suspended', () => {
			if (this.#phase === 'ready') {
				this.#phase = 'suspended';
				this.#overlay.close();
				splash.show('Audio paused by the system. Click to resume.');
			}
		}));
		this.own(soundboard.on('audio.resumed', () => {
			if (this.#phase === 'suspended') {
				this.#phase = 'ready';
				splash.hide();
			}
		}));
		this.own(() => this.#board?.destroy());
		return root;
	}

	#onSplashClick() {
		if (this.#phase === 'start' || this.#phase === 'failed') {
			this.#phase = 'loading';
			this.#splash?.show('Loading…');
			this.#soundboard.start();
		} else if (this.#phase === 'suspended') {
			this.#soundboard.unlockAudio();
		}
	}
}

/** Header with volume sliders, the tile grids, and the player dock. */
class Board extends Component {
	#soundboard;
	#overlay;
	#library;
	#unplayable;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {Overlay} options.overlay
	 * @param {LibraryJson} options.library
	 * @param {Set<string>} options.unplayable
	 */
	constructor({ soundboard, overlay, library, unplayable }) {
		super();
		this.#soundboard = soundboard;
		this.#overlay = overlay;
		this.#library = library;
		this.#unplayable = unplayable;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const overlay = this.#overlay;
		const isPlayable = (/** @type {AudioFileJson} */ file) => !this.#unplayable.has(file.id);

		const header = h('header', { class: 'flex shrink-0 items-center justify-between gap-6 border-b border-line bg-panel px-5 py-3' },
			h('h1', { class: 'text-lg font-semibold tracking-tight' }, 'Soundboard'));
		this.#adopt(new VolumeControls(soundboard).mount(header));

		const main = h('main', { class: 'min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-5' });
		const { playlists, sounds } = this.#library;
		if (playlists.length > 0) {
			const { section, grid } = tileGrid('Playlists');
			for (const playlist of playlists) {
				this.#adopt(new PlaylistTile({ soundboard, overlay, playlist, playable: playlist.tracks.some(isPlayable) }).mount(grid));
			}
			main.append(section);
		}
		if (sounds.length > 0) {
			const { section, grid } = tileGrid('Sound Effects');
			for (const sound of sounds) {
				this.#adopt(new SoundTile({ soundboard, overlay, sound, playable: isPlayable(sound) }).mount(grid));
			}
			main.append(section);
		}
		if (playlists.length === 0 && sounds.length === 0) {
			main.append(h('p', { class: 'text-muted' }, 'No playlists or sounds were found in this folder.'));
		}

		const root = h('div', { class: 'flex h-full flex-col' }, header, main);
		this.#adopt(new PlayerDock({ soundboard, overlay, playlists, isPlayable }).mount(root));
		return root;
	}

	/** @param {Component} child */
	#adopt(child) {
		this.own(() => child.destroy());
	}
}
