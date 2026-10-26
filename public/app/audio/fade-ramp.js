/**
 * The fade a voice was last told to make, in audio context time. `AudioParam.value` only catches up with scheduled
 * changes once the audio thread has run, so a fade that starts right after another is scheduled (silence, then a
 * fade-in) must take its starting level from here instead.
 * @typedef {{ from: number, to: number, start: number, end: number }} FadeRamp
 */

/** @type {Readonly<FadeRamp>} */
export const FULL = Object.freeze({ from: 1, to: 1, start: 0, end: 0 });

/**
 * @param {FadeRamp} ramp
 * @param {number} time
 */
export function levelAt({ from, to, start, end }, time) {
	if (time >= end) {
		return to;
	}
	if (time <= start) {
		return from;
	}
	return from + ((to - from) * (time - start)) / (end - start);
}

/**
 * The ramp that goes from wherever `current` is at `now` to `target` over `seconds`; zero seconds is a jump.
 * @param {FadeRamp} current
 * @param {number} target
 * @param {number} seconds
 * @param {number} now
 * @returns {FadeRamp}
 */
export function rampTo(current, target, seconds, now) {
	const from = seconds > 0 ? levelAt(current, now) : target;
	return { from, to: target, start: now, end: now + Math.max(0, seconds) };
}
