import { Component } from './component.js';
import { h } from './dom.js';
import { GainControl } from './gain-control.js';
import { BUS_SCALE } from './gain-scale.js';
import { icon } from './icons.js';
import { t } from './text.js';

/** @typedef {import('../logic/ports.js').Bus} Bus */
/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** @type {Bus[]} */
const BUSES = ['master', 'music', 'sfx'];

/** The three volume controls in the header (DESIGN.md §6.4): gain widgets that stop at 0 dB, without a boost. */
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
		/** @type {Map<Bus, GainControl>} */
		const controls = new Map();
		const groups = BUSES.map((bus) => {
			const label = t(`volume.${bus}`);
			const control = new GainControl({
				value: volumes[bus],
				scale: BUS_SCALE,
				label: t('volume.label', { name: label }),
				compact: true,
				onChange: (value) => this.#soundboard.setVolume(bus, value),
			});
			const group = h('div', { 'class': 'flex items-center gap-2 text-sm text-muted', 'data-volume': bus }, label);
			control.mount(group);
			controls.set(bus, control);
			this.own(() => control.destroy());
			return group;
		});

		this.own(this.#soundboard.on('volume.changed', ({ bus, value }) => controls.get(bus)?.update(value)));
		return h('div', { class: 'flex items-center gap-5' }, icon('volume', 'size-5 text-muted'), groups);
	}
}
