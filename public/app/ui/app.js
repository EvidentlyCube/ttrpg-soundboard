import { AccessRequestsBanner } from './access-requests-banner.js';
import { AddDialog } from './add-dialog.js';
import { Component } from './component.js';
import { ConnectPhoneDialog } from './connect-phone-dialog.js';
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
import { RemoteView } from './remote-view.js';
import { ReplaceHostDialog } from './replace-host-dialog.js';
import { ProblemsButton } from './problems-button.js';
import { ProblemsDialog } from './problems-dialog.js';
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
/** @typedef {import('../logic/remote-controller.js').RemoteController} RemoteController */

/** @typedef {'start' | 'loading' | 'failed' | 'ready' | 'suspended' | 'stopped' | 'remote'} AppPhase */

/**
 * The whole page: the splash until the soundboard is ready, then the board, or, when the page was started as a remote
 * control, the remote's page instead (DESIGN.md §9, §9.15).
 */
export class App extends Component {
	#soundboard;
	#remote;
	#overlay = new Overlay();
	/** Whether the page was started as the host, and should ask to become it once the board is there. */
	#startAsHost = false;
	/** @type {AppPhase} */
	#phase = 'start';
	/** @type {Splash | null} */
	#splash = null;
	/** @type {Board | null} */
	#board = null;

	/**
	 * @param {Soundboard} soundboard
	 * @param {RemoteController} remote
	 */
	constructor(soundboard, remote) {
		super();
		this.#soundboard = soundboard;
		this.#remote = remote;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const root = h('div', { class: 'h-full' });
		const splash = new Splash({ onClick: () => this.#onSplashClick(), onChoose: (mode) => this.#choose(mode, root) }).mount(root);
		splash.showChoices();
		this.#splash = splash;
		// The splash is the one place that asks the server something before the page has chosen what to be.
		this.#remote.checkHost().then((hostExists) => {
			if (this.#phase === 'start') {
				splash.setHostStatus(hostExists);
			}
		});

		// Safari can suspend audio at any time; resuming is only allowed inside a gesture, so every press tries. A page that
		// has not started, or that is a remote control, has no audio to resume.
		this.own(on(document, 'pointerdown', () => {
			if (this.#phase !== 'start' && this.#phase !== 'remote') {
				soundboard.unlockAudio();
			}
		}, { capture: true }));
		this.own(soundboard.on('app.ready', ({ library, unplayable }) => {
			this.#phase = 'ready';
			splash.hide();
			const board = new Board({ soundboard, overlay: this.#overlay, library, unplayable: new Set(unplayable) });
			board.mount(root);
			this.#board = board;
			if (this.#startAsHost) {
				board.becomeHost();
			}
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
		// The refresh reload is already confirmed by pressing Refresh, so it must not ask again.
		let isRefreshing = false;
		/** @param {BeforeUnloadEvent} event */
		const guardReload = (event) => {
			if (!isRefreshing && soundboard.isAnythingPlaying()) {
				event.preventDefault();
			}
		};
		window.addEventListener('beforeunload', guardReload);
		this.own(() => window.removeEventListener('beforeunload', guardReload));
		this.own(soundboard.on('library.refreshed', () => {
			isRefreshing = true;
			location.reload();
		}));
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

	/**
	 * @param {import('./splash.js').StartMode} mode
	 * @param {HTMLElement} root
	 */
	#choose(mode, root) {
		if (this.#phase !== 'start') {
			return;
		}
		if (mode === 'remote') {
			// A remote control never starts the audio: nothing here may create or resume the audio context.
			this.#phase = 'remote';
			this.#splash?.hide();
			this.own(() => this.#remote.stop());
			new RemoteView(this.#remote).mount(root);
			this.#remote.start();
			return;
		}
		this.#startAsHost = mode === 'host';
		this.#phase = 'loading';
		this.#splash?.show('Loading…');
		this.#soundboard.start();
	}

	#onSplashClick() {
		if (this.#phase === 'failed') {
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
	#problemsDialog = new Dialog();
	#metadataDialog = new Dialog();
	#replaceHostDialog = new Dialog();
	#connectPhoneDialog = new Dialog();
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
		// The header's color and label tell which of the roles this page has (DESIGN.md §9.15).
		const roleLabel = h('span', {
			'class': 'hidden rounded bg-host px-2 py-0.5 text-xs font-bold tracking-widest text-surface uppercase group-data-[role=host]/header:inline-block',
			'title': 'A remote control can control this page',
			'data-role-label': true,
		}, 'Host');
		const menuButton = h('button', {
			'type': 'button',
			'class': 'grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised-hover hover:text-text focus-visible:outline-2 focus-visible:outline-music',
			'title': 'Menu',
			'aria-label': 'Menu',
			'aria-haspopup': 'menu',
			'data-app-menu': true,
			'onClick': () => {
				const { left, bottom } = menuButton.getBoundingClientRect();
				openContextMenu(overlay, appMenuItems({ hosting: soundboard.isHosting() }), { x: left, y: bottom + 4 }, (item) => {
					if (item === 'regenerateWaves') {
						soundboard.regenerateWaveforms();
					} else if (item === 'becomeHost') {
						this.becomeHost();
					} else if (item === 'stopHosting') {
						soundboard.stopHosting();
					} else if (item === 'connectPhone') {
						this.#openConnectPhone();
					}
				});
			},
		}, icon('menu', 'size-5'));
		const header = h('header', {
			'class': 'group/header flex shrink-0 items-center justify-between gap-6 border-b border-line bg-panel px-5 py-3 data-[role=host]:border-host data-[role=host]:bg-host/15',
			'data-role': soundboard.isHosting() ? 'host' : 'standalone',
		},
		h('div', { class: 'flex items-center gap-3' }, menuButton, h('h1', { class: 'text-lg font-semibold tracking-tight' }, 'Soundboard'), roleLabel),
		controls);
		this.own(soundboard.on('host.changed', ({ hosting }) => {
			header.dataset.role = hosting ? 'host' : 'standalone';
		}));
		this.#adopt(new ProblemsButton(soundboard, () => this.#openProblems()).mount(controls));
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
		const requests = new AccessRequestsBanner(soundboard).mount(upper);
		this.#adopt(requests);
		header.after(requests.element);
		this.#adopt(new DownloadDialog(soundboard).mount(upper));
		const root = h('div', { class: 'flex h-full flex-col' }, upper);
		this.#adopt(new PlayerDock({ soundboard, overlay, playlists, isPlayable }).mount(root));
		this.own(() => this.#dialog.close());
		this.own(() => this.#moveDialog.close());
		this.own(() => this.#trashDialog.close());
		this.own(() => this.#problemsDialog.close());
		this.own(() => this.#metadataDialog.close());
		this.own(() => this.#replaceHostDialog.close());
		this.own(() => this.#connectPhoneDialog.close());
		return root;
	}

	#openConnectPhone() {
		const dialog = new ConnectPhoneDialog(this.#soundboard);
		const body = h('div');
		dialog.mount(body);
		this.#connectPhoneDialog.open({ title: 'Connect a phone', body, onClose: () => dialog.destroy() });
	}

	/**
	 * Asks the server to make this page the host. When another page is, a dialog asks first, and only holding its button
	 * takes the role over (DESIGN.md §9.15). A failure shows in the Problems list.
	 */
	async becomeHost() {
		const result = await this.#soundboard.becomeHost();
		if (result !== 'taken') {
			return;
		}
		this.#overlay.close();
		const dialog = new ReplaceHostDialog({
			onReplace: () => {
				this.#replaceHostDialog.close();
				this.#soundboard.becomeHost({ replace: true });
			},
			onCancel: () => this.#replaceHostDialog.close(),
		});
		const body = h('div');
		dialog.mount(body);
		this.#replaceHostDialog.open({ title: 'Replace the host?', body, footer: dialog.footer, onClose: () => dialog.destroy() });
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

	/** Opens the problems dialog, which closes itself once nothing is left. */
	#openProblems() {
		const dialog = new ProblemsDialog({ soundboard: this.#soundboard, onEmpty: () => this.#problemsDialog.close() });
		const body = h('div');
		dialog.mount(body);
		this.#problemsDialog.open({ title: 'Problems', body, footer: dialog.footer, onClose: () => dialog.destroy() });
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
