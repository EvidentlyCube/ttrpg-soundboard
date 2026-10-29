import { Component } from './component.js';
import { h, on } from './dom.js';
import { icon } from './icons.js';
import { PanicButton } from './panic-button.js';
import { TILE_CLASS } from './tile-grid.js';

/** @typedef {import('../logic/remote-controller.js').RemoteController} RemoteController */
/** @typedef {import('../logic/remote-state.js').RemoteState} RemoteState */

const STATUS = { idle: '', loading: 'Loading…', playing: 'Playing', paused: 'Paused' };

const PLAYER_BUTTON = 'grid h-14 flex-1 cursor-pointer place-items-center rounded-lg border border-line bg-raised-hover text-text enabled:active:bg-line disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-music';

/**
 * The page of a remote control (DESIGN.md §9.15): Panic Stop, one row of Previous, Pause/Play and Next for every playlist
 * that plays, and a button for every playlist and sound. It shows what the host reports and sends commands to it; it
 * has no volumes, menus, progress or errors, and never plays anything.
 */
export class RemoteView extends Component {
	#remote;
	/** @type {string} */
	#signature = '';
	#playersSignature = '';
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
		}, 'Remote control');
		const hostStatus = h('span', { 'class': 'text-sm text-muted', 'data-host-status': true });
		const header = h('header', {
			'class': 'flex shrink-0 items-center justify-between gap-3 border-b border-remote bg-remote/15 px-4 py-3',
			'data-role': 'remote',
		}, h('div', { class: 'flex items-center gap-3' }, h('h1', { class: 'text-lg font-semibold tracking-tight' }, 'Soundboard'), roleLabel), hostStatus);

		const notice = h('p', { 'class': 'rounded-lg border border-notice/60 bg-notice/10 px-3 py-2 text-sm text-notice', 'data-remote-notice': true });
		const panic = h('div', { class: 'h-16' });
		this.own(() => panicButton.destroy());
		const panicButton = new PanicButton(remote).mount(panic);
		const players = h('div', { 'class': 'space-y-3', 'data-remote-players': true });
		const top = h('div', { class: 'shrink-0 space-y-3 border-b border-line bg-panel p-4' }, panic, players);

		const playlistGrid = h('div', { class: 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3' });
		const soundGrid = h('div', { class: 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3' });
		const section = (/** @type {string} */ title, /** @type {HTMLElement} */ grid) => h('section', { class: 'space-y-3' },
			h('h2', { class: 'text-xs font-semibold tracking-widest text-muted uppercase' }, title), grid);
		const main = h('main', { class: 'min-h-0 flex-1 space-y-6 overflow-y-auto p-4' }, notice, section('Playlists', playlistGrid), section('Sound Effects', soundGrid));
		const root = h('div', { 'class': 'flex h-full flex-col', 'data-remote-view': true }, header, top, main);

		const show = () => {
			const connected = remote.hostConnected();
			const state = remote.state();
			hostStatus.textContent = connected ? 'Host connected' : 'No host';
			hostStatus.dataset.connected = String(connected);
			notice.hidden = connected && state !== null;
			notice.textContent = connected ? 'Waiting for the host…' : 'No host is connected. Start the page that plays as Host, then this one follows it.';
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
				const status = h('span', { class: 'max-w-full truncate text-xs text-muted' });
				const button = h('button', {
					'type': 'button',
					'class': `${TILE_CLASS} border-l-music data-[active=true]:border-music data-[active=true]:bg-music/20`,
					'data-remote-action': 'playlist',
					'data-playlist-id': playlist.id,
					'data-active': 'false',
					'onClick': () => remote.togglePlaylist(playlist.id),
				}, h('span', { class: 'line-clamp-3 font-medium wrap-anywhere' }, playlist.title), status);
				if (!playlist.playable) {
					button.setAttribute('data-unplayable', '');
				}
				this.#playlistButtons.set(playlist.id, button);
				return button;
			}));
			soundGrid.replaceChildren(...state.sounds.map((sound) => {
				const button = h('button', {
					'type': 'button',
					'class': `${TILE_CLASS} border-l-sfx data-[active=true]:border-sfx data-[active=true]:bg-sfx/20`,
					'data-remote-action': 'sound',
					'data-sound-id': sound.id,
					'data-active': 'false',
					'onClick': () => remote.playSound(sound.id),
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
			const status = button.lastElementChild;
			if (status) {
				status.textContent = player ? STATUS[player.state] : '';
			}
		}
		const active = new Set(state.activeSounds);
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
			const isPaused = player.state === 'paused';
			const control = (/** @type {string} */ action, /** @type {string} */ label, /** @type {Parameters<typeof icon>[0]} */ name, /** @type {() => void} */ handler) => h('button', {
				'type': 'button',
				'class': PLAYER_BUTTON,
				'aria-label': label,
				'title': label,
				'data-remote-action': action,
				'onClick': handler,
			}, icon(name, 'size-7'));
			return h('div', { 'class': 'rounded-lg border border-line bg-raised p-3', 'data-remote-player': player.id },
				h('div', { class: 'mb-2 min-w-0' },
					h('div', { 'class': 'truncate text-xs text-muted', 'data-player-playlist': true }, player.title),
					h('div', { 'class': 'truncate font-medium', 'data-player-track': true }, player.trackTitle ?? '…')),
				h('div', { class: 'flex gap-2' },
					control('previous', 'Previous', 'previous', () => remote.previousTrack(player.id)),
					isPaused
						? control('resume', 'Play', 'play', () => remote.resumePlaylist(player.id))
						: control('pause', 'Pause', 'pause', () => remote.pausePlaylist(player.id)),
					control('next', 'Next', 'next', () => remote.nextTrack(player.id))));
		}));
	}
}
