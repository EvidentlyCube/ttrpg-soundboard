import { PLAYBACK_ORDERS } from '../logic/order-strategies.js';
import { Component } from './component.js';
import { card, radioGroup } from './customize-parts.js';
import { h, on } from './dom.js';
import { GainControl } from './gain-control.js';
import { holdButton } from './hold-button.js';
import { SecondsControl } from './seconds-control.js';
import { SECONDS_LIMITS } from './seconds-scale.js';
import { t } from './text.js';
import { showToast } from './toast.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('../logic/ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('../logic/ports.js').SoundJson} SoundJson */

/** How long each Apply button must be held, longer than a delete since it rewrites the whole library. */
const APPLY_HOLD_MS = 1000;
const TOAST_MS = 3000;

/**
 * @typedef {object} BatchSetting one setting of a batch card
 * @property {string} key the option it changes, such as `fadeIn`
 * @property {string} label
 * @property {unknown} fallback the value shown when the items differ
 * @property {(value: unknown, onChange: (value: unknown) => void) => { element: HTMLElement, destroy?: () => void }} control
 */

/**
 * The Options dialog's Batch tab (DESIGN.md §9.20): cards that give every playlist or every sound the same setting.
 * Each setting is applied only while its box is checked, and each card has its own Apply button, held for a second.
 */
export class BatchOptions extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const playlists = () => soundboard.getLibrary()?.playlists ?? [];
		const sounds = () => soundboard.getLibrary()?.sounds ?? [];

		const playlistCard = (/** @type {string} */ title, /** @type {BatchSetting[]} */ settings) => this.#card({
			title,
			accent: 'music',
			settings,
			items: playlists,
			apply: (changes) => soundboard.customizeAllPlaylists(changes),
			kind: 'playlist',
		});
		const soundCard = (/** @type {string} */ title, /** @type {BatchSetting[]} */ settings) => this.#card({
			title,
			accent: 'sfx',
			settings,
			items: sounds,
			apply: (changes) => soundboard.customizeAllSounds(changes),
			kind: 'sound',
		});

		return h('div', { 'class': 'space-y-8', 'data-batch-options': true },
			h('p', { class: 'text-sm text-muted' }, t('options.batch.intro')),
			playlistCard(t('options.batch.playlistVolume'), [gainSetting('music')]),
			playlistCard(t('options.batch.playlistFades'), [
				secondsSetting('fadeIn', t('customize.fadeIn'), 'music'),
				secondsSetting('crossfade', t('customize.crossfade'), 'music'),
				secondsSetting('fadeOut', t('customize.fadeOut'), 'music'),
			]),
			playlistCard(t('options.batch.playlistOrder'), [orderSetting()]),
			playlistCard(t('options.batch.playlistRepeat'), [
				onOffSetting('playlistLooping', t('customize.repeatPlaylist')),
				onOffSetting('trackLooping', t('customize.repeatTrack')),
			]),
			soundCard(t('options.batch.soundVolume'), [gainSetting('sfx')]),
			soundCard(t('options.batch.soundFades'), [
				secondsSetting('fadeIn', t('customize.fadeIn'), 'sfx'),
				secondsSetting('fadeOut', t('customize.fadeOut'), 'sfx'),
			]));
	}

	/**
	 * A card of batch rows and its Apply button.
	 * @param {object} options
	 * @param {string} options.title
	 * @param {'music' | 'sfx'} options.accent
	 * @param {BatchSetting[]} options.settings
	 * @param {() => (PlaylistJson | SoundJson)[]} options.items what the card changes, read when needed
	 * @param {(changes: Record<string, unknown>) => void} options.apply
	 * @param {'playlist' | 'sound'} options.kind
	 */
	#card({ title, accent, settings, items, apply, kind }) {
		const rows = settings.map((setting) => {
			const shared = sharedValue(items(), setting.key);
			const row = {
				setting,
				value: shared.same ? shared.value : setting.fallback,
				checked: false,
				/** @type {HTMLElement} */
				varies: h('span', { 'class': 'text-xs text-muted', 'hidden': shared.same, 'data-batch-varies': true }, t('options.batch.varies')),
			};
			const control = setting.control(row.value, (value) => {
				row.value = value;
			});
			if (control.destroy) {
				this.own(control.destroy);
			}
			const slot = h('div', { 'class': 'min-w-0 flex-1 transition-opacity data-[enabled=false]:opacity-40', 'data-enabled': 'false', 'inert': true }, control.element);
			// An inert control takes no pointer events, so the cursor comes from this wrapper around it.
			const slotFrame = h('div', { 'class': 'flex min-w-0 flex-1 data-[enabled=false]:cursor-not-allowed', 'data-enabled': 'false' }, slot);
			const box = h('input', {
				'type': 'checkbox',
				'class': `size-4 shrink-0 cursor-pointer ${accent === 'music' ? 'accent-music' : 'accent-sfx'}`,
				'data-batch-apply': setting.key,
			});
			const setChecked = (/** @type {boolean} */ checked) => {
				box.checked = checked;
				row.checked = checked;
				slot.dataset.enabled = String(checked);
				slotFrame.dataset.enabled = String(checked);
				slot.inert = !checked;
			};
			this.own(on(box, 'change', () => {
				setChecked(box.checked);
				updateButton();
			}));
			// The control goes under its name, indented past the box: beside it, a fade control wouldn't fit the dialog.
			const element = h('div', { 'class': 'space-y-2', 'data-batch-row': setting.key },
				h('label', { class: 'flex cursor-pointer items-center gap-3' },
					box,
					h('span', { class: 'text-sm font-medium' }, setting.label),
					row.varies),
				h('div', { class: 'flex pl-7' }, slotFrame));
			// The same object the handlers above change, so Apply reads what they set.
			return Object.assign(row, { element, setChecked });
		});

		/** @type {Set<string>} ids whose save after the last Apply hasn't been reported yet */
		const pending = new Set();
		let failures = 0;
		let total = 0;
		const button = holdButton({
			label: t('options.batch.holdToApply'),
			busyLabel: t('options.batch.applying'),
			holdMs: APPLY_HOLD_MS,
			tone: 'neutral',
			onHold: () => {
				/** @type {Record<string, unknown>} */
				const changes = {};
				for (const row of rows) {
					if (row.checked) {
						changes[row.setting.key] = row.value;
					}
				}
				// Only items that get a new value are changed and saved, so only they are waited for and counted.
				const ids = items()
					.filter((item) => Object.entries(changes).some(([key, value]) => /** @type {Record<string, unknown>} */ (item)[key] !== value))
					.map((item) => item.id);
				apply(changes);
				if (ids.length === 0) {
					finish();
					showToast(t(`options.batch.${kind}Unchanged`), { ms: TOAST_MS });
					return;
				}
				pending.clear();
				ids.forEach((id) => pending.add(id));
				failures = 0;
				total = ids.length;
				button.setBusy(true);
			},
		});
		this.own(button.destroy);
		const updateButton = () => {
			if (pending.size === 0) {
				button.element.disabled = items().length === 0 || !rows.some((row) => row.checked);
			}
		};
		updateButton();

		// The applied values are now every item's own, so the controls keep showing them, with every box cleared.
		const finish = () => {
			rows.forEach((row) => row.setChecked(false));
			button.setBusy(false);
			updateButton();
		};

		/** @param {string} id @param {boolean} ok */
		const settle = (id, ok) => {
			if (!pending.delete(id)) {
				return;
			}
			if (!ok) {
				failures += 1;
			}
			if (pending.size === 0) {
				finish();
				if (failures > 0) {
					showToast(t(`options.batch.${kind}SaveFailed`, { failed: failures, total }), { tone: 'danger', ms: TOAST_MS });
				} else {
					showToast(t(`options.batch.${kind}Applied`, { count: total }), { ms: TOAST_MS });
				}
			}
		};
		const refreshVaries = () => {
			for (const row of rows) {
				row.varies.hidden = sharedValue(items(), row.setting.key).same;
			}
			updateButton();
		};
		const soundboard = this.#soundboard;
		if (kind === 'playlist') {
			this.own(soundboard.on('playlist.saved', (event) => settle(event.playlistId, true)));
			this.own(soundboard.on('playlist.saveFailed', (event) => settle(event.playlistId, false)));
			this.own(soundboard.on('playlist.changed', refreshVaries));
		} else {
			this.own(soundboard.on('sound.saved', (event) => settle(event.soundId, true)));
			this.own(soundboard.on('sound.saveFailed', (event) => settle(event.soundId, false)));
			this.own(soundboard.on('sound.changed', refreshVaries));
		}

		return h('div', { 'data-batch-card': true },
			card(title, accent,
				h('div', { class: 'space-y-4' },
					rows.map((row) => row.element),
					h('div', { class: 'flex justify-end pt-1' }, button.element))));
	}
}

/**
 * @param {(PlaylistJson | SoundJson)[]} items
 * @param {string} key
 * @returns {{ same: boolean, value: unknown }} whether every item has the same value, and that value
 */
function sharedValue(items, key) {
	const values = items.map((item) => /** @type {Record<string, unknown>} */ (item)[key]);
	const same = values.length > 0 && values.every((value) => value === values[0]);
	return { same, value: values[0] };
}

/**
 * @param {'music' | 'sfx'} accent
 * @returns {BatchSetting}
 */
function gainSetting(accent) {
	return {
		key: 'gain',
		label: t('customize.volume'),
		fallback: 1,
		control: (value, onChange) => {
			const control = new GainControl({ value: Number(value), label: t('customize.volume'), accent, onChange });
			const slot = h('div');
			control.mount(slot);
			return { element: slot, destroy: () => control.destroy() };
		},
	};
}

/**
 * The plain fade limits for every timing, the crossfade too: each playlist stores it as given, and the player keeps it
 * within the playlist's own limit (DESIGN.md §8.4).
 * @param {'fadeIn' | 'fadeOut' | 'crossfade'} key
 * @param {string} label
 * @param {'music' | 'sfx'} accent
 * @returns {BatchSetting}
 */
function secondsSetting(key, label, accent) {
	return {
		key,
		label,
		fallback: 0,
		control: (value, onChange) => {
			const control = new SecondsControl({ value: Number(value), name: `batch-${key}`, label, limits: SECONDS_LIMITS, accent, onChange });
			const slot = h('div');
			control.mount(slot);
			return { element: slot, destroy: () => control.destroy() };
		},
	};
}

/** @returns {BatchSetting} */
function orderSetting() {
	return {
		key: 'order',
		label: t('customize.playbackOrder'),
		fallback: 'ordered',
		control: (value, onChange) => radioGroup({
			name: 'batch-order',
			choices: PLAYBACK_ORDERS.map((order) => ({
				value: order,
				label: t(`customize.order.${order}.label`),
				description: t(`customize.order.${order}.description`),
			})),
			value: /** @type {import('../logic/order-strategies.js').PlaybackOrder} */ (value),
			accent: 'music',
			onChange,
		}),
	};
}

/**
 * An on/off setting as two radio buttons, so its value can't be mistaken for the box that says whether to apply it.
 * @param {'playlistLooping' | 'trackLooping'} key
 * @param {string} label
 * @returns {BatchSetting}
 */
function onOffSetting(key, label) {
	return {
		key,
		label,
		fallback: false,
		control: (value, onChange) => {
			const choice = (/** @type {boolean} */ on, /** @type {string} */ text) => h('label', { class: 'flex cursor-pointer items-center gap-2 text-sm' },
				h('input', {
					'type': 'radio',
					'name': `batch-${key}`,
					'checked': value === on,
					'data-radio-value': String(on),
					'class': 'size-4 cursor-pointer accent-music',
					'onChange': () => onChange(on),
				}),
				text);
			return { element: h('div', { 'class': 'flex gap-6 pt-0.5', 'role': 'radiogroup', 'data-radio-group': `batch-${key}` }, choice(true, t('common.on')), choice(false, t('common.off'))) };
		},
	};
}
