import { AddDialog } from './add-dialog.js';
import { Component } from './component.js';
import { openContextMenu } from './context-menu.js';
import { DebugView } from './debug-view.js';
import { DownloadDialog } from './download-dialog.js';
import { ExternalChangesButton } from './external-changes-button.js';
import { Dialog } from './dialog.js';
import { h, on } from './dom.js';
import { icon } from './icons.js';
import { appMenuItems } from './menus.js';
import { MetadataDialog } from './metadata-dialog.js';
import { MoveDialog } from './move-dialog.js';
import { Overlay } from './overlay.js';
import { PlayerDock } from './player-dock.js';
import { PlaylistEditor } from './playlist-editor.js';
import { PlaylistTile } from './playlist-tile.js';
import { SoundEditor } from './sound-editor.js';
import { SoundTile } from './sound-tile.js';
import { Splash } from './splash.js';
import { tileGrid } from './tile-grid.js';
import { TrashButton } from './trash-button.js';
import { TrashDialog } from './trash-dialog.js';
import { VolumeControls } from './volume-controls.js';
import { WaveformIndicator } from './waveform-indicator.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('../logic/ports.js').LibraryJson} LibraryJson */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** @typedef {'start' | 'loading' | 'failed' | 'ready' | 'suspended' | 'stopped'} AppPhase */

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
		// Coming back from another window or tab is when the user has most likely just changed files.
		this.own(on(window, 'focus', () => soundboard.checkExternalChanges()));
		this.own(soundboard.on('library.refreshed', () => location.reload()));
		this.own(soundboard.on('library.refreshFailed', ({ message, restartNeeded }) => {
			if (restartNeeded) {
				this.#phase = 'stopped';
				this.#overlay.close();
				splash.show('The audio folder needs a restart. Restart the app, then reload this page.', message);
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
	/** Stacks on top of a Customize dialog. */
	#moveDialog = new Dialog();
	#trashDialog = new Dialog();
	#metadataDialog = new Dialog();
	/** The item whose Customize dialog is open, so the dialog can close when the item is deleted or moved away. @type {{ kind: 'sound' | 'playlist', id: string } | null} */
	#editing = null;
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

		const controls = h('div', { class: 'flex items-center gap-5' });
		const menuButton = h('button', {
			'type': 'button',
			'class': 'grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised-hover hover:text-text focus-visible:outline-2 focus-visible:outline-music',
			'title': 'Menu',
			'aria-label': 'Menu',
			'aria-haspopup': 'menu',
			'data-app-menu': true,
			'onClick': () => {
				const { left, bottom } = menuButton.getBoundingClientRect();
				openContextMenu(overlay, appMenuItems(), { x: left, y: bottom + 4 }, (item) => {
					if (item === 'regenerateWaves') {
						soundboard.regenerateWaveforms();
					}
				});
			},
		}, icon('menu', 'size-5'));
		const header = h('header', { class: 'flex shrink-0 items-center justify-between gap-6 border-b border-line bg-panel px-5 py-3' },
			h('div', { class: 'flex items-center gap-3' }, menuButton, h('h1', { class: 'text-lg font-semibold tracking-tight' }, 'Soundboard')),
			controls);
		this.#adopt(new ExternalChangesButton(soundboard, (problems) => this.#showRefreshProblems(problems)).mount(controls));
		this.#adopt(new WaveformIndicator(soundboard).mount(controls));
		this.#adopt(new TrashButton(soundboard, () => this.#openTrash()).mount(controls));
		this.#adopt(new VolumeControls(soundboard).mount(controls));
		this.#adopt(new DebugView(soundboard).mount(controls));

		const main = h('main', { class: 'min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-5' });
		const { playlists, sounds } = this.#library;
		const empty = h('p', { class: 'text-muted' }, 'No playlists or sounds were found in this folder.');
		empty.hidden = playlists.length > 0 || sounds.length > 0;

		// Both sections are always there, even empty, so their add buttons can be reached.
		const playlistSection = tileGrid('Playlists', { label: 'Add playlist', accent: 'music', onClick: () => this.#add({ kind: 'newPlaylist' }) });
		const playlistGrid = playlistSection.grid;
		/** @param {import('../logic/ports.js').PlaylistJson} playlist */
		const addPlaylistTile = (playlist) => {
			const tile = new PlaylistTile({
				soundboard,
				overlay,
				playlist,
				playable: playlist.tracks.some(isPlayable),
				onCustomize: (playlistId) => this.#customizePlaylist(playlistId),
				onMetadata: (playlistId) => this.#showMetadata({ kind: 'playlist', id: playlistId }),
			}).mount(playlistGrid);
			this.#playlistTiles.set(playlist.id, tile);
			this.#adopt(tile);
		};
		playlists.forEach(addPlaylistTile);
		this.#playlistGrid = playlistGrid;

		const soundSection = tileGrid('Sound Effects', { label: 'Add sound', accent: 'sfx', onClick: () => this.#add({ kind: 'sound' }) });
		const soundGrid = soundSection.grid;
		/** @param {AudioFileJson} sound */
		const addSoundTile = (sound) => {
			const tile = new SoundTile({
				soundboard,
				overlay,
				sound,
				playable: isPlayable(sound),
				onCustomize: (soundId) => this.#customizeSound(soundId),
				onMetadata: (soundId) => this.#showMetadata({ kind: 'sound', id: soundId }),
			}).mount(soundGrid);
			this.#soundTiles.set(sound.id, tile);
			this.#adopt(tile);
		};
		sounds.forEach(addSoundTile);
		this.#soundGrid = soundGrid;
		main.append(empty, playlistSection.section, soundSection.section);

		// Downloads add items while the board is shown; they take their sorted place at once.
		this.own(soundboard.on('sound.added', ({ sound }) => {
			addSoundTile(sound);
			empty.hidden = true;
			sortTiles(soundboard.getLibrary()?.sounds ?? [], this.#soundTiles, this.#soundGrid);
		}));
		this.own(soundboard.on('playlist.added', ({ playlist }) => {
			addPlaylistTile(playlist);
			empty.hidden = true;
			sortTiles(soundboard.getLibrary()?.playlists ?? [], this.#playlistTiles, this.#playlistGrid);
		}));
		// Deleted or moved away, here or in another tab.
		this.own(soundboard.on('sound.removed', ({ soundId }) => {
			this.#removeTile(this.#soundTiles, soundId, 'sound');
			empty.hidden = this.#soundTiles.size > 0 || this.#playlistTiles.size > 0;
		}));
		this.own(soundboard.on('playlist.removed', ({ playlistId }) => {
			this.#removeTile(this.#playlistTiles, playlistId, 'playlist');
			empty.hidden = this.#soundTiles.size > 0 || this.#playlistTiles.size > 0;
		}));

		// The download dialog covers the header and the board, but not the footer (DESIGN.md §9.10).
		const upper = h('div', { class: 'relative flex min-h-0 flex-1 flex-col' }, header, main);
		this.#adopt(new DownloadDialog(soundboard).mount(upper));
		const root = h('div', { class: 'flex h-full flex-col' }, upper);
		this.#adopt(new PlayerDock({ soundboard, overlay, playlists, isPlayable }).mount(root));
		this.own(() => this.#dialog.close());
		this.own(() => this.#moveDialog.close());
		this.own(() => this.#trashDialog.close());
		this.own(() => this.#metadataDialog.close());
		return root;
	}

	/**
	 * Shows where a sound, or every track of a playlist, came from (DESIGN.md §9.13).
	 * @param {{ kind: 'sound' | 'playlist', id: string }} target
	 */
	#showMetadata(target) {
		const library = this.#soundboard.getLibrary();
		const item = target.kind === 'sound'
			? library?.sounds.find((entry) => entry.id === target.id)
			: library?.playlists.find((entry) => entry.id === target.id);
		if (!item) {
			return;
		}
		const dialog = new MetadataDialog({ soundboard: this.#soundboard, target });
		const body = h('div');
		dialog.mount(body);
		this.#metadataDialog.open({ title: `Metadata: "${item.title}"`, body, onClose: () => dialog.destroy() });
	}

	/** Opens the trash dialog, which closes itself once the trash is empty. */
	#openTrash() {
		const dialog = new TrashDialog({ soundboard: this.#soundboard, onEmpty: () => this.#trashDialog.close() });
		const body = h('div');
		dialog.mount(body);
		this.#trashDialog.open({ title: 'Trash', body, footer: dialog.footer, onClose: () => dialog.destroy() });
	}

	/**
	 * @param {Map<string, Component>} tiles
	 * @param {string} id
	 * @param {'sound' | 'playlist'} kind
	 */
	#removeTile(tiles, id, kind) {
		tiles.get(id)?.destroy();
		tiles.delete(id);
		if (this.#editing?.kind === kind && this.#editing.id === id) {
			this.#dialog.close();
		}
	}

	/**
	 * Opens the move dialog on top of the Customize dialog. A moved sound leaves the library, which closes both; a moved
	 * track only leaves its row, so the playlist dialog stays as it was for the next one.
	 * @param {{ kind: 'sound', id: string } | { kind: 'track', id: string, playlistId: string }} item
	 * @param {string} title
	 */
	#move(item, title) {
		const dialog = new MoveDialog({ soundboard: this.#soundboard, item, onMoved: () => this.#moveDialog.close() });
		const body = h('div');
		dialog.mount(body);
		this.#moveDialog.open({ title: `Move "${title}"`, body, onClose: () => dialog.destroy() });
		dialog.focus();
	}

	/**
	 * Opens the add dialog for a target, or a notice when the server can't download.
	 * @param {{ kind: 'sound' } | { kind: 'newPlaylist' } | { kind: 'playlist', playlistId: string }} target
	 * @param {() => void} [returnTo] reopens the dialog it came from: when it is closed, or once the download it started
	 * 	has been dismissed
	 */
	#add(target, returnTo) {
		const soundboard = this.#soundboard;
		this.#overlay.close();
		const tools = soundboard.getDownloadTools();
		const missing = [tools.ytDlp === null && 'yt-dlp', tools.ffmpeg === null && 'ffmpeg'].filter(Boolean);
		if (missing.length > 0) {
			const body = h('div', { class: 'space-y-3 text-sm' },
				h('p', {}, 'Downloads need yt-dlp and ffmpeg.'),
				h('p', {}, `${missing.join(' and ')} ${missing.length === 1 ? 'was' : 'were'} not found when the app started. Install ${missing.length === 1 ? 'it' : 'them'}, then restart the app.`));
			this.#dialog.open({ title: 'Downloads are not available', body, onClose: returnTo });
			return;
		}
		/** @type {Record<typeof target.kind, string>} */
		const titles = { sound: 'Add sounds', newPlaylist: 'Add a playlist', playlist: 'Add tracks' };
		let title = titles[target.kind];
		if (target.kind === 'playlist') {
			const playlist = soundboard.getLibrary()?.playlists.find((entry) => entry.id === target.playlistId);
			title = `Add tracks to ${playlist?.title ?? target.playlistId}`;
		}
		let started = false;
		const dialog = new AddDialog({
			soundboard,
			target,
			onStarted: () => {
				started = true;
				this.#dialog.close();
			},
		});
		this.#openEditor(title, dialog, () => {
			if (!returnTo) {
				return;
			}
			if (!started) {
				returnTo();
				return;
			}
			// The download dialog covers the board while it runs; the way back opens once it is dismissed.
			const unsubscribe = soundboard.on('download.changed', ({ job }) => {
				if (job === null) {
					unsubscribe();
					returnTo();
				}
			});
			this.own(unsubscribe);
		});
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
			const editor = new SoundEditor({ soundboard, sound, onMove: () => this.#move({ kind: 'sound', id: soundId }, sound.title) });
			this.#openEditor('Customize sound', editor, () => {
				soundboard.flushSoundOptions(soundId);
				sortTiles(soundboard.getLibrary()?.sounds ?? [], this.#soundTiles, this.#soundGrid);
			}, { kind: 'sound', id: soundId });
		}
	}

	/**
	 * @param {string} playlistId
	 * @param {'playlist' | 'tracks'} [tab]
	 */
	#customizePlaylist(playlistId, tab) {
		const soundboard = this.#soundboard;
		const playlist = soundboard.getLibrary()?.playlists.find((entry) => entry.id === playlistId);
		if (playlist) {
			const editor = new PlaylistEditor({
				soundboard,
				playlist,
				tab,
				// The add dialog takes this one's place, and gives it back on the Tracks tab when it is done.
				onAddTracks: () => this.#add({ kind: 'playlist', playlistId }, () => this.#customizePlaylist(playlistId, 'tracks')),
				onMoveTrack: (track) => this.#move({ kind: 'track', id: track.id, playlistId }, track.title),
			});
			this.#openEditor('Customize playlist', editor, () => {
				editor.flushEdits();
				sortTiles(soundboard.getLibrary()?.playlists ?? [], this.#playlistTiles, this.#playlistGrid);
			}, { kind: 'playlist', id: playlistId });
		}
	}

	/** @param {{ path: string, message: string }[]} problems */
	#showRefreshProblems(problems) {
		this.#overlay.close();
		const list = h('ul', { class: 'space-y-2 text-sm' }, ...problems.map(({ path, message }) => h('li', {},
			path !== '' && h('span', { class: 'font-medium text-text' }, `${path}: `),
			h('span', { class: 'text-muted' }, message))));
		const body = h('div', { class: 'space-y-4' },
			h('p', {}, 'Nothing was loaded. Fix or delete these files, then refresh again:'),
			list);
		this.#dialog.open({ title: 'Could not load the changes', body });
	}

	/**
	 * @param {string} title
	 * @param {SoundEditor | PlaylistEditor | AddDialog} editor
	 * @param {() => void} onClose
	 * @param {{ kind: 'sound' | 'playlist', id: string }} [editing] the item the dialog customizes
	 */
	#openEditor(title, editor, onClose, editing) {
		this.#overlay.close();
		const body = h('div');
		editor.mount(body);
		this.#dialog.open({
			title,
			body,
			footer: editor instanceof SoundEditor || editor instanceof PlaylistEditor ? editor.footer : undefined,
			onClose: () => {
				this.#editing = null;
				this.#moveDialog.close();
				editor.destroy();
				onClose();
			},
		});
		this.#editing = editing ?? null;
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
