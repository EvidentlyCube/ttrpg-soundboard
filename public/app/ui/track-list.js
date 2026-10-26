import { h } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('../logic/ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./overlay.js').Overlay} Overlay */

/**
 * The player bar's track list popover (DESIGN.md §9.2): every track, the current one marked.
 * @param {Overlay} overlay
 * @param {object} options
 * @param {AudioFileJson[]} options.tracks
 * @param {number | null} options.currentIndex
 * @param {(track: AudioFileJson) => boolean} options.isPlayable
 * @param {{ x: number, y: number }} options.point
 * @param {(index: number) => void} options.onSelect
 */
export function openTrackList(overlay, { tracks, currentIndex, isPlayable, point, onSelect }) {
	const rows = tracks.map((track, index) => {
		const current = index === currentIndex;
		return h('button', {
			'type': 'button',
			'role': 'menuitem',
			'disabled': !isPlayable(track),
			'title': isPlayable(track) ? track.title : `This browser cannot play ${track.format.toUpperCase()} files`,
			'data-current': String(current),
			'data-track-index': index,
			'class': 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text outline-none enabled:cursor-pointer enabled:hover:bg-raised-hover enabled:focus-visible:bg-raised-hover disabled:text-muted/50 data-[current=true]:text-music',
			'onClick': () => {
				overlay.close();
				onSelect(index);
			},
		},
		h('span', { class: 'w-6 shrink-0 text-right text-xs tabular-nums text-muted' }, String(index + 1)),
		h('span', { class: 'min-w-0 flex-1 truncate' }, track.title),
		current ? icon('play', 'size-4 shrink-0') : null);
	});
	const panel = h('div', { role: 'menu', class: 'max-h-80 w-80 overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-xl shadow-black/50' }, rows);
	overlay.open(panel, point);
	panel.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' });
}
