import { Component } from './component.js';
import { h, on } from './dom.js';
import { icon } from './icons.js';
import { PanicButton } from './panic-button.js';
import { t } from './text.js';

/** @typedef {import('../logic/remote-controller.js').RemoteController} RemoteController */
/** @typedef {import('../logic/remote-state.js').RemoteState} RemoteState */

const PLAYER_BUTTON = 'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-line bg-raised-hover text-text enabled:active:bg-line disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-music';

const TILE = 'flex aspect-[4/3] w-full flex-col items-start justify-start overflow-hidden rounded-md border border-l-4 border-line bg-raised p-2 text-left leading-tight text-text transition-colors enabled:cursor-pointer enabled:active:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-40';

const MIN_COLUMNS = 1;
const MAX_COLUMNS = 8;
const MIN_CLICK_GAP = 60;
const MIN_FONT = 10;
const MAX_FONT = 28;
const COLUMNS_KEY = 'soundboard-remote-columns';
const FONT_KEY = 'soundboard-remote-font';

/**
 * @param {string} key
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function saved(key, min, max, fallback) {
	try {
		const value = Number(localStorage.getItem(key));
		return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
	} catch {
		return fallback;
	}
}

/**
 * @param {string} key
 * @param {number} value
 */
function save(key, value) {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Only the memory of the size is lost.
	}
}

/**
 * The page of a remote control (DESIGN.md §9.15): Panic Stop, one row of Stop and Next for every playlist
 * that plays, and a button for every playlist and sound. It shows what the host reports and sends commands to it; it
 * has no volumes, menus, progress or errors, and never plays anything.
 */
export class RemoteView extends Component {
	#remote;
	/** @type {string} */
	#signature = '';
	#playersSignature = '';
	/** @type {Set<string>} */
	#activeSounds = new Set();
	/** @type {Map<string, HTMLElement>} */
	#playlistButtons = new Map();
	/** @type {Map<string, HTMLElement>} */
	#soundButtons = new Map();

	/** @param {RemoteController} remote */
	constructor(remote) {
		super();
		this.#remote = remote;
	}

	/** @override */
	render() {
		const remote = this.#remote;
		const roleLabel = h('span', {
			'class': 'rounded bg-remote px-2 py-0.5 text-xs font-bold tracking-widest text-surface uppercase',
			'data-role-label': true,
		}, t('remote.label'));
		const hostStatus = h('span', { 'class': 'size-3 rounded-full bg-danger data-[connected=true]:bg-host', 'data-host-status': true, 'role': 'img' });
		const panic = h('div', { class: 'h-10 w-20' });
		this.own(() => panicButton.destroy());
		const panicButton = new PanicButton(remote).mount(panic);
		const header = h('header', {
			'class': 'flex shrink-0 items-center justify-between gap-3 border-b border-remote bg-remote/15 px-3 py-2',
			'data-role': 'remote',
		}, h('div', { class: 'flex items-center gap-2' }, roleLabel, hostStatus), panic);

		const notice = h('p', { 'class': 'rounded-md border border-notice/60 bg-notice/10 px-2 py-1.5 text-sm text-notice', 'data-remote-notice': true });
		const players = h('div', { 'class': 'space-y-1.5', 'data-remote-players': true });
		const top = h('div', { class: 'shrink-0 empty:hidden border-b border-line bg-panel p-2' }, players);

		let columns = saved(COLUMNS_KEY, MIN_COLUMNS, MAX_COLUMNS, 3);
		let font = saved(FONT_KEY, MIN_FONT, MAX_FONT, 14);
		const playlistGrid = h('div', { class: 'grid gap-2' });
		const soundGrid = h('div', { class: 'grid gap-2' });
		const applyZoom = () => {
			for (const grid of [playlistGrid, soundGrid]) {
				grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
				grid.style.fontSize = `${font}px`;
			}
			zoomOut.disabled = columns >= MAX_COLUMNS;
			zoomIn.disabled = columns <= MIN_COLUMNS;
			fontSmaller.disabled = font <= MIN_FONT;
			fontLarger.disabled = font >= MAX_FONT;
			save(COLUMNS_KEY, columns);
			save(FONT_KEY, font);
		};
		let lastSizeClick = -Infinity;
		const sizeButton = (/** @type {string} */ label, /** @type {string} */ symbol, /** @type {string} */ name, /** @type {() => void} */ change) => h('button', {
			'type': 'button',
			'class': 'grid h-9 min-w-9 cursor-pointer touch-manipulation place-items-center rounded-md border border-line bg-raised-hover px-2 text-lg font-bold text-text select-none enabled:active:bg-line disabled:cursor-not-allowed disabled:opacity-40',
			'aria-label': label,
			'title': label,
			'data-remote-zoom': name,
			'onClick': (/** @type {MouseEvent} */ event) => {
				// Firefox's touch emulation sends a double tap as three clicks, the extra one at the same instant as another.
				if (event.timeStamp - lastSizeClick < MIN_CLICK_GAP) {
					return;
				}
				lastSizeClick = event.timeStamp;
				change();
				applyZoom();
				// The buttons move as the tiles resize; keeping them at the bottom lets the next press land on them again.
				main.scrollTop = main.scrollHeight;
			},
		}, symbol);
		const zoomIn = sizeButton(t('remote.largerButtons'), '+', 'in', () => {
			columns = Math.max(MIN_COLUMNS, columns - 1);
		});
		const zoomOut = sizeButton(t('remote.smallerButtons'), '−', 'out', () => {
			columns = Math.min(MAX_COLUMNS, columns + 1);
		});
		const fontLarger = sizeButton(t('remote.largerText'), 'A+', 'font-larger', () => {
			font = Math.min(MAX_FONT, font + 1);
		});
		const fontSmaller = sizeButton(t('remote.smallerText'), 'A−', 'font-smaller', () => {
			font = Math.max(MIN_FONT, font - 1);
		});
		applyZoom();
		const sizes = h('div', { class: 'mt-auto flex justify-center gap-3 pt-2' }, zoomOut, zoomIn, fontSmaller, fontLarger);
		const section = (/** @type {string} */ title, /** @type {HTMLElement} */ grid) => h('section', { class: 'space-y-1.5' },
			h('h2', { class: 'text-xs font-semibold tracking-widest text-muted uppercase' }, title), grid);
		const main = h('main', { class: 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2' }, notice, section(t('board.playlists'), playlistGrid), section(t('board.sounds'), soundGrid), sizes);
		const root = h('div', { 'class': 'flex h-full flex-col', 'data-remote-view': true }, header, top, main);

		const show = () => {
			const connected = remote.hostConnected();
			const state = remote.state();
			hostStatus.title = connected ? t('remote.hostConnected') : t('remote.noHost');
			hostStatus.setAttribute('aria-label', hostStatus.title);
			hostStatus.dataset.connected = String(connected);
			notice.hidden = connected && state !== null;
			notice.textContent = connected ? t('remote.waiting') : t('remote.noHostNotice');
			if (state) {
				this.#showState(state, { playlistGrid, soundGrid, players });
			} else {
				this.#signature = '';
				this.#playersSignature = '';
				this.#playlistButtons.clear();
				this.#soundButtons.clear();
				playlistGrid.replaceChildren();
				soundGrid.replaceChildren();
				players.replaceChildren();
			}
			for (const button of root.querySelectorAll('button[data-remote-action]')) {
				/** @type {HTMLButtonElement} */ (button).disabled = !connected || button.hasAttribute('data-unplayable');
			}
		};
		show();
		this.own(remote.on('remote.hostChanged', show));
		this.own(remote.on('remote.stateChanged', show));
		// The server forgot this device, so `/` shows the waiting page, then pairing once a soundboard is open again.
		this.own(remote.on('remote.closed', () => window.location.assign('/')));
		this.own(on(root, 'contextmenu', (event) => event.preventDefault()));
		return root;
	}

	/**
	 * @param {RemoteState} state
	 * @param {{ playlistGrid: HTMLElement, soundGrid: HTMLElement, players: HTMLElement }} parts
	 */
	#showState(state, { playlistGrid, soundGrid, players }) {
		const remote = this.#remote;
		// The buttons are built again only when titles or the lists change, so a press is never lost to an update.
		const signature = JSON.stringify([state.playlists, state.sounds]);
		if (signature !== this.#signature) {
			this.#signature = signature;
			this.#playlistButtons.clear();
			this.#soundButtons.clear();
			playlistGrid.replaceChildren(...state.playlists.map((playlist) => {
				const button = h('button', {
					'type': 'button',
					'class': `${TILE} border-l-music data-[active=true]:border-music data-[active=true]:bg-music/20`,
					'data-remote-action': 'playlist',
					'data-playlist-id': playlist.id,
					'data-active': 'false',
					'onClick': () => remote.togglePlaylist(playlist.id),
				}, h('span', { class: 'line-clamp-3 font-medium wrap-anywhere' }, playlist.title));
				if (!playlist.playable) {
					button.setAttribute('data-unplayable', '');
				}
				this.#playlistButtons.set(playlist.id, button);
				return button;
			}));
			soundGrid.replaceChildren(...state.sounds.map((sound) => {
				const button = h('button', {
					'type': 'button',
					'class': `${TILE} border-l-sfx data-[active=true]:border-sfx data-[active=true]:bg-sfx/20`,
					'data-remote-action': 'sound',
					'data-sound-id': sound.id,
					'data-active': 'false',
					'onClick': () => (this.#activeSounds.has(sound.id) ? remote.stopSound(sound.id) : remote.playSound(sound.id)),
				}, h('span', { class: 'line-clamp-3 font-medium wrap-anywhere' }, sound.title));
				if (!sound.playable) {
					button.setAttribute('data-unplayable', '');
				}
				this.#soundButtons.set(sound.id, button);
				return button;
			}));
		}
		const playing = new Map(state.players.map((player) => [player.id, player]));
		for (const [id, button] of this.#playlistButtons) {
			const player = playing.get(id);
			button.dataset.active = String(player !== undefined);
		}
		const active = this.#activeSounds = new Set(state.activeSounds);
		for (const [id, button] of this.#soundButtons) {
			button.dataset.active = String(active.has(id));
		}
		// Rows that did not change stay as they are, so a press is never lost to an update that brings nothing new.
		const playersSignature = JSON.stringify(state.players);
		if (playersSignature === this.#playersSignature) {
			return;
		}
		this.#playersSignature = playersSignature;
		players.replaceChildren(...state.players.map((player) => {
			const control = (/** @type {string} */ action, /** @type {string} */ label, /** @type {Parameters<typeof icon>[0]} */ name, /** @type {() => void} */ handler) => h('button', {
				'type': 'button',
				'class': PLAYER_BUTTON,
				'aria-label': label,
				'title': label,
				'data-remote-action': action,
				'onClick': handler,
			}, icon(name, 'size-5'));
			return h('div', { 'class': 'flex items-center gap-2 rounded-md border border-line bg-raised px-2 py-1', 'data-remote-player': player.id },
				h('div', { class: 'min-w-0 flex-1 text-sm leading-tight' },
					h('div', { 'class': 'truncate text-xs text-muted', 'data-player-playlist': true }, player.title),
					h('div', { 'class': 'truncate font-medium', 'data-player-track': true }, player.trackTitle ?? '…')),
				control('stop', t('player.stop'), 'stop', () => remote.stopPlaylist(player.id)),
				control('next', t('player.next'), 'forward-step', () => remote.nextTrack(player.id)));
		}));
	}
}
