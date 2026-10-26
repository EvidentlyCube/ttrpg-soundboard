import { Component } from './component.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('../logic/ports.js').Bus} Bus */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** @type {[Bus, string][]} */
const SLIDERS = [['master', 'Master'], ['music', 'Music'], ['sfx', 'Sound Effects']];

/** The three volume sliders in the header (DESIGN.md §6.4). */
export class VolumeControls extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const volumes = this.#soundboard.getVolumes();
		/** @type {Map<Bus, HTMLInputElement>} */
		const inputs = new Map();
		const sliders = SLIDERS.map(([bus, label]) => {
			const input = h('input', {
				'type': 'range',
				'min': '0',
				'max': '1',
				'step': '0.01',
				'value': String(volumes[bus]),
				'aria-label': `${label} volume`,
				'data-volume': bus,
				'class': 'w-28 cursor-pointer accent-music',
				'onInput': () => this.#soundboard.setVolume(bus, Number(input.value)),
			});
			inputs.set(bus, input);
			return h('label', { class: 'flex items-center gap-2 text-sm text-muted' }, label, input);
		});

		this.own(this.#soundboard.on('volume.changed', ({ bus, value }) => {
			const input = inputs.get(bus);
			// Never fight the slider the user is dragging.
			if (input && document.activeElement !== input && Number(input.value) !== value) {
				input.value = String(value);
			}
		}));
		return h('div', { class: 'flex items-center gap-5' }, icon('volume', 'size-5 text-muted'), sliders);
	}
}
