import { InvalidCommandError } from './errors.js';

/** @typedef {import('./ports.js').Bus} Bus */
/** @typedef {import('./ports.js').Volumes} Volumes */
/** @typedef {{ type: 'volume.changed', bus: Bus, value: number }} VolumeChangedEvent */

/** @type {readonly Bus[]} */
export const BUSES = ['master', 'music', 'sfx'];

/**
 * Squaring the slider position spreads loudness more evenly across the slider than a linear gain does.
 * @param {number} value slider position, 0..1
 */
export function sliderToGain(value) {
	return value ** 2;
}

/** The three volume sliders (DESIGN.md §6.4): holds their positions and applies them as bus gains. */
export class VolumeControl {
	#setBusGain;
	#emit;
	/** @type {Volumes} */
	#volumes = { master: 1, music: 1, sfx: 1 };

	/**
	 * @param {object} ports
	 * @param {(bus: Bus, gain: number) => void} ports.setBusGain
	 * @param {(event: VolumeChangedEvent) => void} ports.emit
	 */
	constructor({ setBusGain, emit }) {
		this.#setBusGain = setBusGain;
		this.#emit = emit;
	}

	/** @returns {Volumes} */
	get volumes() {
		return { ...this.#volumes };
	}

	/**
	 * @param {Bus} bus
	 * @param {number} value clamped to 0..1
	 */
	setVolume(bus, value) {
		if (!BUSES.includes(bus)) {
			throw new InvalidCommandError(`Unknown volume bus "${bus}"`);
		}
		if (typeof value !== 'number' || Number.isNaN(value)) {
			throw new InvalidCommandError(`Volume must be a number, got ${String(value)}`);
		}
		const clamped = Math.min(1, Math.max(0, value));
		this.#apply(bus, clamped);
		this.#emit({ type: 'volume.changed', bus, value: clamped });
	}

	/**
	 * Applies saved volumes at startup, without announcing each one.
	 * @param {Volumes} volumes
	 */
	applyAll(volumes) {
		for (const bus of BUSES) {
			this.#apply(bus, volumes[bus]);
		}
	}

	/**
	 * @param {Bus} bus
	 * @param {number} value
	 */
	#apply(bus, value) {
		this.#volumes[bus] = value;
		this.#setBusGain(bus, sliderToGain(value));
	}
}
