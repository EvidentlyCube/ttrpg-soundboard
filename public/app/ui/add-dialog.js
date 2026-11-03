import { Component } from './component.js';
import { card, radioGroup } from './customize-parts.js';
import { h } from './dom.js';
import { filledField } from './filled-field.js';
import { formatBytes, formatTime } from './format.js';
import { t } from './text.js';

/** @typedef {import('../logic/ports.js').LinkProbe} LinkProbe */
/** @typedef {import('../logic/ports.js').DownloadTarget} DownloadTarget */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {'music' | 'sfx'} Accent */

/** A download this large, or of unknown size, gets a warning, so a huge file is never fetched by accident. */
export const LARGE_DOWNLOAD_BYTES = 500_000_000;

/** Colors written out in full so Tailwind generates them (DESIGN.md §9.6). */
const BUTTON_ACCENTS = {
	music: 'bg-music hover:bg-music/85',
	sfx: 'bg-sfx hover:bg-sfx/85',
};
const CHECK_ACCENTS = { music: 'accent-music', sfx: 'accent-sfx' };
const LINK_ACCENTS = { music: 'text-music', sfx: 'text-sfx' };

/**
 * The body of the dialog that adds sounds or tracks from a link (DESIGN.md §9.9): paste a link, look it up, choose
 * what to keep, download. Starting the download hands over to the download dialog.
 */
export class AddDialog extends Component {
	#soundboard;
	#target;
	#onStarted;
	/** @type {HTMLInputElement | null} */
	#linkInput = null;

	/**
	 * @param {object} options
	 * @param {Soundboard} options.soundboard
	 * @param {{ kind: 'sound' } | { kind: 'newPlaylist' } | { kind: 'playlist', playlistId: string }} options.target a new
	 * 	playlist's title is chosen in the dialog
	 * @param {() => void} options.onStarted the download has started; close the dialog
	 */
	constructor({ soundboard, target, onStarted }) {
		super();
		this.#soundboard = soundboard;
		this.#target = target;
		this.#onStarted = onStarted;
	}

	/** @override */
	render() {
		const accent = /** @type {Accent} */ (this.#target.kind === 'sound' ? 'sfx' : 'music');
		const link = filledField({ label: t('add.link'), accent, align: 'left', width: 'w-full', attributes: { 'inputmode': 'url', 'data-add-link': true, 'spellcheck': 'false' } });
		this.#linkInput = link.input;
		const lookUp = h('button', {
			'type': 'button',
			'class': `shrink-0 cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-surface disabled:cursor-wait disabled:opacity-60 ${BUTTON_ACCENTS[accent]}`,
			'data-add-look-up': true,
		}, t('add.lookUp'));
		const error = h('p', { 'class': 'text-sm text-danger', 'hidden': true, 'data-add-error': true });
		const result = h('div', { class: 'space-y-8' });

		/** @param {string} message */
		const showError = (message) => {
			error.textContent = message;
			error.hidden = false;
		};

		/** @param {{ playlist?: boolean }} [options] */
		const run = async ({ playlist = false } = {}) => {
			const url = link.input.value.trim();
			if (url === '') {
				link.input.focus();
				return;
			}
			error.hidden = true;
			lookUp.disabled = true;
			lookUp.textContent = t('add.lookingUp');
			result.replaceChildren();
			try {
				const probe = await this.#soundboard.probeLink(url, { playlist });
				result.replaceChildren(this.#choices(probe, accent, showError, () => run({ playlist: true })));
			} catch (problem) {
				showError(problem instanceof Error ? problem.message : String(problem));
			} finally {
				lookUp.disabled = false;
				lookUp.textContent = t('add.lookUp');
			}
		};
		lookUp.addEventListener('click', () => run());
		link.input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				run();
			}
		});

		return h('div', { class: 'space-y-6' },
			h('div', { class: 'space-y-2' },
				h('div', { class: 'flex items-end gap-3' }, h('div', { class: 'min-w-0 flex-1' }, link.element), lookUp),
				h('p', { class: 'text-xs text-muted' }, t('add.linkHint')),
				error),
			result);
	}

	/** Focuses the link field, for when the dialog opens. */
	focus() {
		this.#linkInput?.focus();
	}

	/**
	 * What the lookup found, the choices it allows, and the Download button.
	 * @param {LinkProbe} probe
	 * @param {Accent} accent
	 * @param {(message: string) => void} showError
	 * @param {() => void} lookUpPlaylist looks the link up again as the playlist it names
	 */
	#choices(probe, accent, showError, lookUpPlaylist) {
		const parts = [];
		/** @type {() => { chapters?: number[] | null, entries?: string[] } | null} null while nothing is chosen */
		let selection = () => ({});
		/** @type {number | null | 'many'} the download's size; a playlist's is never known */
		let size;

		if (probe.kind === 'file') {
			size = probe.size;
			parts.push(card(t('add.file'), accent, summary(probe.name, [probe.contentType, probe.size === null ? t('add.sizeUnknown') : formatBytes(probe.size)])));
		} else if (probe.kind === 'video') {
			size = probe.size;
			const details = [probe.duration === null ? null : formatTime(probe.duration), probe.size === null ? t('add.sizeUnknown') : formatBytes(probe.size)];
			const videoCard = card(t('add.video'), accent, summary(probe.title, details));
			if (probe.playlistAvailable) {
				videoCard.append(h('button', {
					'type': 'button',
					'class': `mt-3 cursor-pointer text-sm underline-offset-2 hover:underline ${LINK_ACCENTS[accent]}`,
					'data-add-whole-playlist': true,
					'onClick': lookUpPlaylist,
				}, t('add.wholePlaylist')));
			}
			parts.push(videoCard);
			if (probe.chapters.length > 0) {
				const list = checklist({
					accent,
					rows: probe.chapters.map((chapter, index) => ({ id: String(index), title: chapter.title, detail: formatTime(chapter.end - chapter.start) })),
					onChange: () => refresh(),
				});
				list.element.hidden = true;
				let split = false;
				const mode = radioGroup({
					name: 'add-mode',
					accent,
					value: 'whole',
					choices: [
						{ value: 'whole', label: t('add.oneFile'), description: t('add.oneFileHint') },
						{ value: 'chapters', label: t('add.splitChapters'), description: t('add.splitChaptersHint', { count: probe.chapters.length }) },
					],
					onChange: (value) => {
						split = value === 'chapters';
						list.element.hidden = !split;
						refresh();
					},
				});
				parts.push(card(t('add.chapters'), accent, mode.element, list.element));
				selection = () => {
					if (!split) {
						return { chapters: null };
					}
					const chosen = list.chosen().map(Number);
					return chosen.length > 0 ? { chapters: chosen } : null;
				};
			}
		} else {
			size = 'many';
			const list = checklist({
				accent,
				rows: probe.entries.map((entry) => ({ id: entry.id, title: entry.title, detail: entry.duration === null ? '' : formatTime(entry.duration) })),
				onChange: () => refresh(),
			});
			const note = probe.truncated
				? h('p', { class: 'mt-3 text-xs text-muted' }, t('add.truncated', { count: probe.entries.length }))
				: null;
			parts.push(card(t('add.playlist'), accent, summary(probe.title, [t('add.entries', { count: probe.entries.length })]), h('div', { class: 'mt-4' }, list.element), note));
			selection = () => {
				const chosen = list.chosen();
				return chosen.length > 0 ? { entries: chosen } : null;
			};
		}

		/** @type {HTMLInputElement | null} */
		let titleInput = null;
		if (this.#target.kind === 'newPlaylist') {
			const field = filledField({
				label: t('add.playlistTitle'),
				accent,
				align: 'left',
				width: 'w-full',
				attributes: { 'value': probe.kind === 'file' ? probe.name.replace(/\.[^.]+$/, '') : probe.title, 'data-add-playlist-title': true },
			});
			field.input.addEventListener('input', () => refresh());
			titleInput = field.input;
			parts.push(card(t('add.newPlaylist'), accent, field.element));
		}

		const warning = h('p', { 'class': 'text-sm text-notice', 'data-add-warning': true });
		if (size === null) {
			warning.textContent = t('add.unknownSizeWarning');
		} else if (typeof size === 'number' && size > LARGE_DOWNLOAD_BYTES) {
			warning.textContent = t('add.largeWarning');
		} else {
			warning.hidden = true;
		}
		const download = h('button', {
			'type': 'button',
			'class': `cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-surface disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_ACCENTS[accent]}`,
			'data-add-download': true,
		}, typeof size === 'number' ? t('add.downloadSize', { size: formatBytes(size) }) : t('add.download'));

		const refresh = () => {
			download.disabled = selection() === null || (titleInput !== null && titleInput.value.trim() === '');
		};
		refresh();

		download.addEventListener('click', async () => {
			const chosen = selection();
			if (chosen === null) {
				return;
			}
			/** @type {DownloadTarget} */
			const target = this.#target.kind === 'newPlaylist'
				? { kind: 'newPlaylist', title: /** @type {HTMLInputElement} */ (titleInput).value.trim() }
				: this.#target;
			download.disabled = true;
			try {
				await this.#soundboard.startDownload({ probeId: probe.probeId, target, ...chosen });
				this.#onStarted();
			} catch (problem) {
				showError(problem instanceof Error ? problem.message : String(problem));
				refresh();
			}
		});

		return h('div', { class: 'space-y-8 pt-3' },
			...parts,
			h('div', { class: 'flex items-center justify-end gap-4' }, warning, download));
	}
}

/**
 * A title with small details below it.
 * @param {string} title
 * @param {(string | null)[]} details
 */
function summary(title, details) {
	return h('div', { class: 'space-y-0.5' },
		h('p', { class: 'font-medium wrap-anywhere' }, title),
		h('p', { class: 'text-xs text-muted' }, details.filter((detail) => detail !== null).join(' · ')));
}

/**
 * Checkboxes for chapters or entries, all ticked, with Select all and Select none.
 * @param {object} options
 * @param {Accent} options.accent
 * @param {{ id: string, title: string, detail: string }[]} options.rows
 * @param {() => void} options.onChange
 * @returns {{ element: HTMLElement, chosen: () => string[] }}
 */
function checklist({ accent, rows, onChange }) {
	const count = h('span', { class: 'text-xs text-muted' });
	const inputs = rows.map((row) => h('input', {
		'type': 'checkbox',
		'checked': true,
		'value': row.id,
		'class': `size-4 shrink-0 cursor-pointer ${CHECK_ACCENTS[accent]}`,
		'data-add-choice': row.id,
	}));
	const showCount = () => {
		count.textContent = t('add.chosen', { chosen: inputs.filter((input) => input.checked).length, count: inputs.length });
	};
	/** @param {boolean} checked */
	const setAll = (checked) => {
		for (const input of inputs) {
			input.checked = checked;
		}
		showCount();
		onChange();
	};
	for (const input of inputs) {
		input.addEventListener('change', () => {
			showCount();
			onChange();
		});
	}
	showCount();
	const toolButton = (/** @type {string} */ label, /** @type {boolean} */ checked) => h('button', {
		type: 'button',
		class: `cursor-pointer text-xs underline-offset-2 hover:underline ${LINK_ACCENTS[accent]}`,
		onClick: () => setAll(checked),
	}, label);
	const element = h('div', { class: 'mt-4 space-y-2' },
		h('div', { class: 'flex items-center gap-4' }, toolButton(t('add.selectAll'), true), toolButton(t('add.selectNone'), false), h('span', { class: 'flex-1' }), count),
		h('ul', { class: 'max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line' },
			rows.map((row, index) => h('li', {},
				h('label', { class: 'flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-raised-hover' },
					inputs[index],
					h('span', { class: 'min-w-0 flex-1 truncate text-sm', title: row.title }, row.title),
					h('span', { class: 'shrink-0 text-xs text-muted tabular-nums' }, row.detail))))));
	return { element, chosen: () => inputs.filter((input) => input.checked).map((input) => input.value) };
}
