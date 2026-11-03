import { Component } from './component.js';
import { h } from './dom.js';
import { formatBytes, formatMegabytes } from './format.js';
import { holdButton } from './hold-button.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('../logic/ports.js').TrashTarget} TrashTarget */
/** @typedef {import('../logic/ports.js').TrashListing} TrashListing */
/** @typedef {ReturnType<typeof holdButton>} HoldButton */

/** Single items are held for half a second, everything at once for two (DESIGN.md §9.12). */
const HOLD_ALL_MS = 2000;

/** Stripe colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const STRIPES = { playlist: 'bg-music', track: 'bg-music/40', sound: 'bg-sfx' };

/**
 * Lists what the trash holds (DESIGN.md §9.12): playlists with their tracks indented beneath them, then sounds. Each
 * can be restored or deleted for good, and the footer does either for everything. The list is fetched when the dialog
 * opens and again whenever the trash changes, in this tab or another.
 */
export class TrashDialog extends Component {
	#soundboard;
	#onEmpty;
	/** @type {HoldButton[]} */
	#rowButtons = [];
	/** @type {HoldButton[]} */
	#footerButtons = [];
	/** Answers to older requests are dropped. */
	#generation = 0;
	#busy = false;
	/** @type {HTMLElement | null} */
	#footer = null;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {() => void} options.onEmpty closes the dialog once nothing is left
	 */
	constructor({ soundboard, onEmpty }) {
		super();
		this.#soundboard = soundboard;
		this.#onEmpty = onEmpty;
	}

	/** The total and the buttons for everything, which the dialog keeps below the scrolling list. */
	get footer() {
		if (!this.#footer) {
			throw new Error('TrashDialog is not mounted');
		}
		return this.#footer;
	}

	/** @override */
	render() {
		const list = h('div', { 'class': 'space-y-5', 'data-trash-list': true }, h('p', { class: 'text-sm text-muted' }, t('common.loading')));
		const error = h('p', { 'class': 'mb-2 text-sm text-danger', 'hidden': true, 'data-trash-error': true });
		const total = h('span', { class: 'flex-1 text-sm text-muted' });

		const restoreAll = holdButton({
			label: t('trash.restoreAll'),
			busyLabel: t('trash.restoring'),
			holdMs: HOLD_ALL_MS,
			tone: 'neutral',
			onHold: () => this.#act(() => this.#soundboard.restoreFromTrash('all'), restoreAll, 'restore', error, list, total),
		});
		const deleteAll = holdButton({
			label: t('trash.deleteAll'),
			busyLabel: t('trash.deleting'),
			holdMs: HOLD_ALL_MS,
			onHold: () => this.#act(() => this.#soundboard.deleteFromTrash('all'), deleteAll, 'delete', error, list, total),
		});
		this.#footerButtons = [restoreAll, deleteAll];
		this.#footer = h('div', {}, error, h('div', { class: 'flex items-center gap-3' }, total, restoreAll.element, deleteAll.element));

		this.#load(list, error, total);
		this.own(this.#soundboard.on('trash.changed', ({ count }) => {
			if (count === 0) {
				this.#onEmpty();
			} else if (!this.#busy) {
				this.#load(list, error, total);
			}
		}));
		this.own(() => {
			for (const button of [...this.#rowButtons, ...this.#footerButtons]) {
				button.destroy();
			}
		});
		return list;
	}

	/**
	 * @param {HTMLElement} list
	 * @param {HTMLElement} error
	 * @param {HTMLElement} total
	 */
	async #load(list, error, total) {
		const generation = ++this.#generation;
		let listing;
		try {
			listing = await this.#soundboard.loadTrash();
		} catch (reason) {
			if (generation === this.#generation) {
				showError(error, 'trash.readFailed', reason);
			}
			return;
		}
		if (generation !== this.#generation) {
			return;
		}
		if (listing.playlists.length === 0 && listing.sounds.length === 0) {
			this.#onEmpty();
			return;
		}
		total.textContent = t('trash.total', { size: formatMegabytes(listing.size) });
		this.#showListing(listing, list, error, total);
	}

	/**
	 * @param {TrashListing} listing
	 * @param {HTMLElement} list
	 * @param {HTMLElement} error
	 * @param {HTMLElement} total
	 */
	#showListing({ playlists, sounds }, list, error, total) {
		for (const button of this.#rowButtons) {
			button.destroy();
		}
		this.#rowButtons = [];

		/**
		 * @param {object} entry
		 * @param {'playlist' | 'track' | 'sound'} entry.kind
		 * @param {string} entry.id
		 * @param {string} entry.title
		 * @param {string} entry.detail
		 */
		const row = ({ kind, id, title, detail }) => {
			/** @type {TrashTarget} */
			const target = { kind, id };
			const restore = holdButton({
				label: t('trash.restore'),
				busyLabel: t('trash.restoring'),
				tone: 'neutral',
				onHold: () => this.#act(() => this.#soundboard.restoreFromTrash(target), restore, 'restore', error, list, total),
			});
			const remove = holdButton({
				label: t('trash.delete'),
				busyLabel: t('trash.deleting'),
				onHold: () => this.#act(() => this.#soundboard.deleteFromTrash(target), remove, 'delete', error, list, total),
			});
			this.#rowButtons.push(restore, remove);
			// Tracks sit indented under their playlist, so it is clear where they belong.
			return h('li', {
				'class': `flex items-stretch gap-3 rounded-md border border-line ${kind === 'track' ? 'ml-6' : ''}`,
				'data-trash-item': kind,
			},
			h('span', { class: `w-1.5 shrink-0 rounded-l-md ${STRIPES[kind]}` }),
			h('span', { class: 'min-w-0 flex-1 py-2' },
				h('span', { class: 'block truncate text-sm font-medium', title }, title),
				h('span', { class: 'block truncate text-xs text-muted', title: detail }, detail)),
			h('span', { class: 'flex shrink-0 items-center gap-2 pr-2' }, restore.element, remove.element));
		};
		/** @param {import('../logic/ports.js').TrashedFileJson} file */
		const fileDetail = (file, /** @type {string} */ path) => [file.title === path ? null : path, formatBytes(file.size)].filter(Boolean).join(' · ');
		/**
		 * @param {string} heading
		 * @param {HTMLElement[]} rows
		 */
		const section = (heading, rows) => {
			if (rows.length === 0) {
				return null;
			}
			return h('section', { class: 'space-y-2' },
				h('h3', { class: 'text-xs font-semibold tracking-wide text-muted uppercase' }, heading),
				h('ul', { class: 'space-y-2' }, rows));
		};

		list.replaceChildren(...[
			section(t('board.playlists'), playlists.flatMap((playlist) => [
				row({ kind: 'playlist', id: playlist.id, title: playlist.title, detail: `${t('playlist.trackCount', { count: playlist.tracks.length })} · ${formatBytes(playlist.size)}` }),
				...playlist.tracks.map((track) => row({
					kind: 'track',
					id: track.id,
					title: track.title,
					detail: fileDetail(track, track.id.slice(playlist.id.length + 1)),
				})),
			])),
			section(t('move.sounds'), sounds.map((sound) => row({ kind: 'sound', id: sound.id, title: sound.title, detail: fileDetail(sound, sound.id) }))),
		].filter((child) => child !== null));
		this.#setDisabled(this.#busy);
	}

	/**
	 * Runs one action at a time, with every button disabled meanwhile, then reads the trash again.
	 * @param {() => Promise<void>} action
	 * @param {HoldButton} button
	 * @param {'restore' | 'delete'} verb
	 * @param {HTMLElement} error
	 * @param {HTMLElement} list
	 * @param {HTMLElement} total
	 */
	async #act(action, button, verb, error, list, total) {
		if (this.#busy) {
			return;
		}
		this.#busy = true;
		this.#setDisabled(true);
		button.setBusy(true);
		error.hidden = true;
		try {
			await action();
		} catch (reason) {
			showError(error, verb === 'restore' ? 'trash.restoreFailed' : 'trash.deleteFailed', reason);
		}
		this.#busy = false;
		button.setBusy(false);
		this.#setDisabled(false);
		this.#load(list, error, total);
	}

	/** @param {boolean} disabled */
	#setDisabled(disabled) {
		for (const button of [...this.#rowButtons, ...this.#footerButtons]) {
			button.element.disabled = disabled;
		}
	}
}

/**
 * @param {HTMLElement} error
 * @param {'trash.readFailed' | 'trash.restoreFailed' | 'trash.deleteFailed'} what
 * @param {unknown} reason
 */
function showError(error, what, reason) {
	error.textContent = t(what, { reason: reason instanceof Error ? reason.message : String(reason) });
	error.hidden = false;
}
