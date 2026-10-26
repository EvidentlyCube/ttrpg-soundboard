import { Component } from './component.js';
import { Dialog } from './dialog.js';
import { h, on } from './dom.js';
import { Overlay } from './overlay.js';
import { PlayerDock } from './player-dock.js';
import { PlaylistEditor } from './playlist-editor.js';
import { PlaylistTile } from './playlist-tile.js';
import { SoundEditor } from './sound-editor.js';
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
	#dialog = new Dialog();
	/** @type {Map<string, SoundTile>} */
	#soundTiles = new Map();
	/** @type {HTMLElement | null} */
	#soundGrid = null;
	/** @type {Map<string, PlaylistTile>} */
	#playlistTiles = new Map();
	/** @type {HTMLElement | null} */
	#playlistGrid = null;

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
			const onCustomize = (/** @type {string} */ playlistId) => this.#customizePlaylist(playlistId);
			for (const playlist of playlists) {
				const tile = new PlaylistTile({ soundboard, overlay, playlist, playable: playlist.tracks.some(isPlayable), onCustomize }).mount(grid);
				this.#playlistTiles.set(playlist.id, tile);
				this.#adopt(tile);
			}
			this.#playlistGrid = grid;
			main.append(section);
		}
		if (sounds.length > 0) {
			const { section, grid } = tileGrid('Sound Effects');
			const onCustomize = (/** @type {string} */ soundId) => this.#customizeSound(soundId);
			for (const sound of sounds) {
				const tile = new SoundTile({ soundboard, overlay, sound, playable: isPlayable(sound), onCustomize }).mount(grid);
				this.#soundTiles.set(sound.id, tile);
				this.#adopt(tile);
			}
			this.#soundGrid = grid;
			main.append(section);
		}
		if (playlists.length === 0 && sounds.length === 0) {
			main.append(h('p', { class: 'text-muted' }, 'No playlists or sounds were found in this folder.'));
		}

		const root = h('div', { class: 'flex h-full flex-col' }, header, main);
		this.#adopt(new PlayerDock({ soundboard, overlay, playlists, isPlayable }).mount(root));
		this.own(() => this.#dialog.close());
		return root;
	}

	/** @param {Component} child */
	#adopt(child) {
		this.own(() => child.destroy());
	}

	/** @param {string} soundId */
	#customizeSound(soundId) {
		const soundboard = this.#soundboard;
		const sound = soundboard.getLibrary()?.sounds.find((entry) => entry.id === soundId);
		if (sound) {
			this.#openEditor('Customize sound', new SoundEditor({ soundboard, sound }), () => {
				soundboard.flushSoundOptions(soundId);
				sortTiles(soundboard.getLibrary()?.sounds ?? [], this.#soundTiles, this.#soundGrid);
			});
		}
	}

	/** @param {string} playlistId */
	#customizePlaylist(playlistId) {
		const soundboard = this.#soundboard;
		const playlist = soundboard.getLibrary()?.playlists.find((entry) => entry.id === playlistId);
		if (playlist) {
			const editor = new PlaylistEditor({ soundboard, playlist });
			this.#openEditor('Customize playlist', editor, () => {
				editor.flushEdits();
				sortTiles(soundboard.getLibrary()?.playlists ?? [], this.#playlistTiles, this.#playlistGrid);
			});
		}
	}

	/**
	 * @param {string} title
	 * @param {SoundEditor | PlaylistEditor} editor
	 * @param {() => void} onClose
	 */
	#openEditor(title, editor, onClose) {
		this.#overlay.close();
		const body = h('div');
		editor.mount(body);
		this.#dialog.open({
			title,
			body,
			onClose: () => {
				editor.destroy();
				onClose();
			},
		});
		editor.focus();
	}
}

/**
 * Moves tiles into the library's order. Done only when editing ends, so a tile never moves while it is renamed.
 * @param {{ id: string }[]} items in the library's order
 * @param {Map<string, Component>} tiles
 * @param {HTMLElement | null} grid
 */
function sortTiles(items, tiles, grid) {
	for (const item of items) {
		const tile = tiles.get(item.id);
		if (tile && grid) {
			grid.append(tile.element);
		}
	}
}
