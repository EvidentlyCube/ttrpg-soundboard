import { Component } from './component.js';
import { h } from './dom.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** Destination colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const DESTINATION_ACCENTS = {
	sfx: { stripe: 'bg-sfx', hover: 'hover:bg-sfx/15', text: 'text-sfx' },
	music: { stripe: 'bg-music', hover: 'hover:bg-music/15', text: 'text-music' },
};

/**
 * Where a sound or a track can go (DESIGN.md §9.11): the sound effects first, in amber, then every playlist, in blue.
 * The item's current place is greyed out. Picking a destination moves the item at once.
 */
export class MoveDialog extends Component {
	#soundboard;
	#item;
	#onMoved;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {{ kind: 'sound', id: string } | { kind: 'track', id: string, playlistId: string }} options.item
	 * @param {() => void} options.onMoved
	 */
	constructor({ soundboard, item, onMoved }) {
		super();
		this.#soundboard = soundboard;
		this.#item = item;
		this.#onMoved = onMoved;
	}

	/** @override */
	render() {
		const item = this.#item;
		const library = this.#soundboard.getLibrary();
		const current = item.kind === 'sound' ? null : item.playlistId;
		const error = h('p', { 'class': 'text-sm text-danger', 'hidden': true, 'data-move-error': true });
		/** @type {HTMLButtonElement[]} */
		const buttons = [];

		/**
		 * @param {string | null} target a playlist id, or null for the sound effects
		 * @param {string} name
		 * @param {string} detail
		 * @param {keyof typeof DESTINATION_ACCENTS} accent
		 */
		const destination = (target, name, detail, accent) => {
			const here = target === current;
			const colors = DESTINATION_ACCENTS[accent];
			const button = h('button', {
				'type': 'button',
				'class': `flex w-full cursor-pointer items-stretch gap-3 rounded-md border border-line text-left ${colors.hover} disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent`,
				'disabled': here,
				'data-move-target': target ?? '',
				'onClick': () => this.#move(target, buttons, error),
			},
			h('span', { class: `w-1.5 shrink-0 rounded-l-md ${colors.stripe}` }),
			h('span', { class: 'min-w-0 flex-1 py-2 pr-3' },
				h('span', { class: `block truncate text-sm font-medium ${here ? '' : colors.text}` }, name),
				h('span', { class: 'block text-xs text-muted' }, here ? t('move.hereNow', { detail }) : detail)));
			buttons.push(button);
			return h('li', {}, button);
		};
		const list = h('ul', { 'class': 'space-y-2', 'data-move-targets': true },
			destination(null, t('move.sounds'), t('move.soundCount', { count: library?.sounds.length ?? 0 }), 'sfx'),
			...(library?.playlists ?? []).map((playlist) => destination(playlist.id, playlist.title, t('playlist.trackCount', { count: playlist.tracks.length }), 'music')));
		return h('div', { class: 'space-y-4' }, list, error);
	}

	/**
	 * @param {string | null} target
	 * @param {HTMLButtonElement[]} buttons
	 * @param {HTMLElement} error
	 */
	async #move(target, buttons, error) {
		const item = this.#item;
		const enabled = buttons.filter((button) => !button.disabled);
		enabled.forEach((button) => {
			button.disabled = true;
		});
		error.hidden = true;
		try {
			if (item.kind === 'sound') {
				// The sound effects are its current place, so their button is disabled and target is never null.
				await this.#soundboard.moveSound(item.id, /** @type {string} */ (target));
			} else {
				await this.#soundboard.moveTrack(item.id, target);
			}
			this.#onMoved();
		} catch (reason) {
			enabled.forEach((button) => {
				button.disabled = false;
			});
			error.textContent = t('move.failed', { reason: reason instanceof Error ? reason.message : String(reason) });
			error.hidden = false;
		}
	}

	/** Focuses the first destination that can be picked, for when the dialog opens. */
	focus() {
		/** @type {HTMLButtonElement | null} */ (this.element.querySelector('[data-move-target]:not(:disabled)'))?.focus();
	}
}
