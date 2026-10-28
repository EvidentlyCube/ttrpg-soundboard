import { Component } from './component.js';
import { h, on } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('../logic/waveform-service.js').WaveformStatus} WaveformStatus */

/**
 * The header's waveform progress (DESIGN.md §9.1): shown only while waveforms are being made, or when some are still
 * missing or failed. Its button stops generation and starts it again. The bar and the text change many times, so they
 * are set through an inline style and text (DESIGN.md §9.6).
 */
export class WaveformIndicator extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const label = h('span', { class: 'tabular-nums' });
		const fill = h('div', { class: 'h-full rounded-full bg-muted', style: { width: '0%' } });
		const bar = h('div', { class: 'h-1 w-20 overflow-hidden rounded-full bg-line' }, fill);
		const button = h('button', {
			'type': 'button',
			'class': 'cursor-pointer rounded p-1 text-muted hover:bg-line hover:text-text focus-visible:outline-2 focus-visible:outline-music',
			'data-waveform-toggle': true,
		});
		const root = h('div', { 'class': 'flex items-center gap-2 text-sm text-muted', 'data-waveform-indicator': true }, label, bar, button);

		/** @param {WaveformStatus} status */
		const show = (status) => {
			const { running, done, total, failed } = status;
			root.hidden = !running && done >= total && failed === 0;
			const counts = total === 0 ? '…' : `${done} / ${total}`;
			label.textContent = `Waveforms ${counts}${failed > 0 ? `, ${failed} failed` : ''}${!running && done < total ? ', stopped' : ''}`;
			fill.style.width = `${total === 0 ? 0 : (done / total) * 100}%`;
			bar.hidden = !running && failed > 0 && done >= total;
			button.replaceChildren(icon(running ? 'stop' : 'play', 'size-4'));
			button.title = running ? 'Stop making waveforms' : 'Make the missing waveforms';
			button.setAttribute('aria-label', button.title);
			button.dataset.running = String(running);
		};
		show(soundboard.getWaveformStatus());

		this.own(soundboard.on('waveforms.progress', ({ status }) => show(status)));
		this.own(on(button, 'click', () => {
			if (soundboard.getWaveformStatus().running) {
				soundboard.stopWaveforms();
			} else {
				soundboard.startWaveforms();
			}
		}));
		return root;
	}
}
