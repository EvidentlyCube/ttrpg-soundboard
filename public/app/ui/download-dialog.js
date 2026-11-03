import { Component } from './component.js';
import { h } from './dom.js';
import { t } from './text.js';

/** @typedef {import('../logic/ports.js').DownloadJob} DownloadJob */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** As many lines as the server keeps (DESIGN.md §5.4). */
const MAX_LINES = 1000;

const STEPS = ['waiting', 'downloading', 'converting', 'done', 'failed', 'cancelled'];

/**
 * Shows the server's download with the output of the tool running (DESIGN.md §9.10). While a download exists it
 * covers the header and the board, but not the footer, so music can still be skipped or stopped. It can't be dismissed
 * until the download has ended; it is shown in every tab, and again after a reload.
 */
export class DownloadDialog extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const heading = h('h2', { class: 'truncate text-base font-semibold' });
		const target = h('p', { class: 'text-sm text-muted' });
		const current = h('p', { 'class': 'truncate text-sm', 'data-download-current': true });
		const summary = h('div', { 'class': 'space-y-1 text-sm', 'hidden': true, 'data-download-summary': true });
		const log = h('div', {
			'class': 'h-80 overflow-y-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs leading-5 text-muted',
			'data-download-log': true,
		});
		const cancel = h('button', {
			'type': 'button',
			'class': 'cursor-pointer rounded-md border border-line px-4 py-2 text-sm hover:bg-raised-hover',
			'data-download-cancel': true,
			'onClick': () => {
				if (window.confirm(t('download.confirmCancel'))) {
					soundboard.cancelDownload();
				}
			},
		}, t('download.cancel'));
		const close = h('button', {
			'type': 'button',
			'class': 'cursor-pointer rounded-md bg-music px-4 py-2 text-sm font-medium text-surface hover:bg-music/85',
			'hidden': true,
			'data-download-close': true,
			'onClick': () => soundboard.dismissDownload(),
		}, t('common.close'));
		const panel = h('div', {
			'role': 'dialog',
			'aria-modal': 'true',
			'aria-label': t('download.label'),
			'class': 'flex max-h-full w-full max-w-2xl flex-col gap-4 rounded-xl border border-line bg-panel p-5 shadow-2xl',
		},
		h('div', { class: 'space-y-1' }, heading, target),
		current,
		summary,
		log,
		h('div', { class: 'flex justify-end gap-3' }, cancel, close));
		// The footer stays usable, so the layer covers only the area above it (DESIGN.md §9.10).
		const layer = h('div', {
			'class': 'absolute inset-0 z-20 grid place-items-center bg-black/60 p-4',
			'hidden': true,
			'data-download-dialog': true,
		}, panel);

		/** Rows of the log, one per line, so a progress line can be rewritten in place. @type {HTMLElement[]} */
		let rows = [];
		/** @param {string} text */
		const row = (text) => h('div', { class: 'break-all whitespace-pre-wrap' }, text);
		const atBottom = () => log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
		/**
		 * @param {string[]} lines
		 * @param {boolean} replaceLast
		 */
		const append = (lines, replaceLast) => {
			const follow = atBottom();
			const [first, ...rest] = lines;
			if (replaceLast && rows.length > 0 && first !== undefined) {
				rows[rows.length - 1].textContent = first;
			} else if (first !== undefined) {
				rest.unshift(first);
			}
			const added = rest.map(row);
			log.append(...added);
			rows.push(...added);
			for (const old of rows.splice(0, Math.max(0, rows.length - MAX_LINES))) {
				old.remove();
			}
			if (follow) {
				log.scrollTop = log.scrollHeight;
			}
		};
		const resetLog = () => {
			rows = (soundboard.getDownload()?.log ?? []).map(row);
			log.replaceChildren(...rows);
			log.scrollTop = log.scrollHeight;
		};

		/** @param {DownloadJob | null} job */
		const show = (job) => {
			layer.hidden = job === null;
			if (!job) {
				return;
			}
			const running = job.state === 'running';
			heading.textContent = t(`download.heading.${job.state}`, { title: job.title });
			target.textContent = job.target.kind === 'sound' ? t('download.addingSounds') : t('download.addingTo', { playlist: job.targetTitle });
			const item = job.current === null ? null : job.items[job.current];
			current.hidden = !running || item === null;
			if (item) {
				const step = STEPS.includes(item.state) ? t(`download.step.${/** @type {'waiting'} */ (item.state)}`) : '';
				current.textContent = t('download.current', { step, item: /** @type {number} */ (job.current) + 1, count: job.items.length, title: item.title });
			}
			summary.hidden = running;
			if (!running) {
				const failed = job.items.filter((entry) => entry.state === 'failed');
				summary.replaceChildren(
					h('p', { class: 'font-medium' }, [
						t('download.added', { count: job.added }),
						job.failed > 0 && t('download.failed', { count: job.failed }),
						job.state === 'cancelled' && t('download.restCancelled'),
					].filter(Boolean).join(', ') + t('download.summaryEnd')),
					...failed.map((entry) => h('p', { class: 'text-danger' }, t('download.itemFailed', { title: entry.title, reason: entry.error ?? t('download.step.failed') }))));
			}
			cancel.hidden = !running;
			close.hidden = running;
		};

		this.own(soundboard.on('download.changed', ({ job, logReset }) => {
			if (logReset) {
				resetLog();
			}
			show(job);
		}));
		this.own(soundboard.on('download.log', ({ lines, replaceLast }) => append(lines, replaceLast)));
		resetLog();
		show(soundboard.getDownload()?.job ?? null);
		return layer;
	}
}
