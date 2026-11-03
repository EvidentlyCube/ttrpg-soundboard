import { Component } from './component.js';
import { h, on } from './dom.js';
import { formatDb } from './gain-scale.js';
import { icon } from './icons.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('../logic/voice-monitor.js').VoiceInfo} VoiceInfo */

/** How often the volumes are read while the panel is open; they move without any event announcing it. */
const REFRESH_MS = 250;

const BADGES = {
	sfx: 'bg-sfx/20 text-sfx',
	music: 'bg-music/20 text-music',
};

/** The language files' keys for the statuses, which name them in words. */
const STATUS_KEYS = /** @type {const} */ ({
	'loading': 'loading',
	'playing': 'playing',
	'paused': 'paused',
	'fading in': 'fadingIn',
	'fading out': 'fadingOut',
	'ended': 'ended',
	'stopped': 'stopped',
	'error': 'error',
});

/**
 * The debug view (DESIGN.md §9.8): a panel below a red header button, listing the voices the audio engine is playing,
 * oldest first, with their status and own volume. Both are hidden until the Debug dialog shows them, and the button only
 * hides them again. The list is static: a voice keeps its row until it goes away, and rows are updated in place.
 */
export class DebugView extends Component {
	#soundboard;
	#shown = false;
	/** @type {(shown: boolean) => void} */
	#setShown = () => {};

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	isShown() {
		return this.#shown;
	}

	show() {
		this.#setShown(true);
	}

	hide() {
		this.#setShown(false);
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		/** @type {Map<number, { row: HTMLElement, status: HTMLElement, volume: HTMLElement }>} */
		const rows = new Map();
		/** @type {number | null} */
		let timer = null;

		const empty = h('p', { 'class': 'px-3 py-2 text-sm text-muted', 'data-debug-empty': true }, t('debug.voices.empty'));
		const list = h('ol', { 'class': 'max-h-[60vh] min-w-96 divide-y divide-line overflow-y-auto', 'data-debug-list': true }, empty);
		const panel = h('div', {
			'id': 'debug-panel',
			'class': 'absolute top-full right-0 z-[60] mt-2 overflow-hidden rounded-lg border border-line bg-panel shadow-xl shadow-black/40',
			'data-debug-panel': true,
		}, list);

		/** @param {VoiceInfo} voice */
		const createRow = (voice) => {
			const bus = voice.bus === 'music' ? 'music' : 'sfx';
			const status = h('span', { class: 'w-20 shrink-0 text-xs text-muted group-data-[status=error]:text-danger' });
			const volume = h('span', { class: 'w-20 shrink-0 text-right text-xs tabular-nums' });
			const row = h('li', {
				'class': 'group flex items-center gap-3 px-3 py-1.5 text-sm data-[finished=true]:opacity-50',
				'data-voice': voice.serial,
			},
			h('span', { class: `w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-[0.65rem] font-semibold uppercase ${BADGES[bus]}` }, t(`debug.voices.${bus}`)),
			h('span', { class: 'min-w-0 flex-1 truncate', title: voice.label }, voice.label),
			status,
			volume);
			return { row, status, volume };
		};

		const refresh = () => {
			const voices = soundboard.getVoices();
			const present = new Set(voices.map((voice) => voice.serial));
			for (const [serial, entry] of rows) {
				if (!present.has(serial)) {
					entry.row.remove();
					rows.delete(serial);
				}
			}
			for (const voice of voices) {
				let entry = rows.get(voice.serial);
				if (!entry) {
					entry = createRow(voice);
					rows.set(voice.serial, entry);
					list.append(entry.row);
				}
				entry.row.dataset.status = voice.status;
				entry.row.dataset.finished = String(voice.finished);
				setText(entry.status, t(`debug.voices.status.${STATUS_KEYS[voice.status]}`));
				entry.status.title = voice.message ?? '';
				setText(entry.volume, formatDb(voice.volume));
			}
			empty.hidden = rows.size > 0;
		};

		const button = h('button', {
			'type': 'button',
			'class': 'flex size-8 cursor-pointer items-center justify-center rounded-md bg-danger/15 text-danger hover:bg-danger/25',
			'title': t('debug.hideView'),
			'aria-label': t('debug.hideView'),
			'aria-controls': 'debug-panel',
			'data-debug-toggle': true,
			'onClick': () => this.hide(),
		}, icon('bug', 'size-5'));
		const view = h('div', { 'class': 'relative', 'hidden': true, 'data-debug-view': true }, button, panel);

		this.#setShown = (shown) => {
			this.#shown = shown;
			view.hidden = !shown;
			if (timer !== null) {
				window.clearInterval(timer);
				timer = null;
			}
			if (shown) {
				refresh();
				timer = window.setInterval(refresh, REFRESH_MS);
			}
		};

		this.own(soundboard.on('voices.changed', () => {
			if (this.#shown) {
				refresh();
			}
		}));
		// A dialog or a menu on top takes Esc first; this only hides the view when nothing else is open.
		this.own(on(document, 'keydown', (event) => {
			if (event.key === 'Escape' && this.#shown && !document.querySelector('[data-overlay-backdrop], [data-dialog-body]')) {
				this.hide();
			}
		}));
		this.own(() => {
			if (timer !== null) {
				window.clearInterval(timer);
			}
		});
		return view;
	}
}

/**
 * Rows are rewritten several times a second, so text only changes when it differs.
 * @param {HTMLElement} element
 * @param {string} text
 */
function setText(element, text) {
	if (element.textContent !== text) {
		element.textContent = text;
	}
}
