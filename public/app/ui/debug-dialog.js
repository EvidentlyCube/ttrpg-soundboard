import { Component } from './component.js';
import { card } from './customize-parts.js';
import { h, on } from './dom.js';
import { showToast } from './toast.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('./debug-view.js').DebugView} DebugView */

const BUTTON_CLASS = 'cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-default disabled:border-line disabled:bg-transparent disabled:text-muted';

/** Each tool's color, written out in full so Tailwind generates them (DESIGN.md §9.6). Red matches the header button. */
const COLORS = {
	waveforms: 'border-music/60 bg-music/15 text-music hover:bg-music/25',
	debugView: 'border-danger/60 bg-danger/15 text-danger hover:bg-danger/25',
};

/** How long the note that regenerating has started stays in the corner. */
const TOAST_MS = 3000;

/** The body of the Debug dialog: tools for troubleshooting, each in its own section (DESIGN.md §9.8). */
export class DebugDialog extends Component {
	#soundboard;
	#debugView;

	/**
	 * @param {Soundboard} soundboard
	 * @param {DebugView} debugView
	 */
	constructor(soundboard, debugView) {
		super();
		this.#soundboard = soundboard;
		this.#debugView = debugView;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const debugView = this.#debugView;

		const regenerate = h('button', { 'type': 'button', 'class': `${BUTTON_CLASS} ${COLORS.waveforms}`, 'data-debug-tool': 'regenerateWaveforms' });
		/** @param {boolean} running */
		const showRunning = (running) => {
			regenerate.disabled = running;
			regenerate.textContent = running ? 'Making waveforms…' : 'Regenerate waveforms';
		};
		showRunning(soundboard.getWaveformStatus().running);
		this.own(soundboard.on('waveforms.progress', ({ status }) => showRunning(status.running)));
		this.own(on(regenerate, 'click', () => {
			soundboard.regenerateWaveforms();
			showToast('Regenerating every waveform.', { ms: TOAST_MS });
		}));

		const toggle = h('button', { 'type': 'button', 'class': `${BUTTON_CLASS} ${COLORS.debugView}`, 'data-debug-tool': 'toggleDebugView' });
		const showToggle = () => {
			toggle.textContent = debugView.isShown() ? 'Hide debug view' : 'Show debug view';
		};
		showToggle();
		this.own(on(toggle, 'click', () => {
			if (debugView.isShown()) {
				debugView.hide();
			} else {
				debugView.show();
			}
			showToggle();
		}));

		return h('div', { 'class': 'min-w-96 space-y-8 pt-3 text-sm', 'data-debug-dialog': true },
			card('Waveforms', 'neutral', tool('Makes every waveform again, even those that exist.', regenerate)),
			card('Debug view', 'neutral', tool('Lists the voices the audio engine plays, below a red button in the header.', toggle)));
	}
}

/**
 * @param {string} text
 * @param {HTMLButtonElement} button
 * @returns {HTMLElement}
 */
function tool(text, button) {
	return h('div', { class: 'flex flex-col items-start gap-3' }, h('p', { class: 'text-muted' }, text), button);
}
