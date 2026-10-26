/** @typedef {import('./playback-rules.js').PlaybackRules} PlaybackRules */

/**
 * `default` follows the playlist's rules; `instant` ignores them and silences everything at once (DESIGN.md §6.1).
 * @typedef {'default' | 'instant'} Transition
 */

/** @typedef {'play' | 'stop' | 'change'} TransitionAction */

/**
 * @typedef {object} TransitionTiming
 * @property {number} fadeInSeconds for the voice that starts
 * @property {number} fadeOutSeconds for the voice that stops
 * @property {boolean} killRetiring whether voices still fading out are cut immediately
 */

/** @type {readonly Transition[]} */
const TRANSITIONS = ['default', 'instant'];

/**
 * @param {unknown} value
 * @returns {value is Transition}
 */
export function isTransition(value) {
	return TRANSITIONS.includes(/** @type {Transition} */ (value));
}

/**
 * @param {TransitionAction} action
 * @param {Transition} transition
 * @param {Readonly<PlaybackRules>} rules
 * @returns {TransitionTiming}
 */
export function resolveTransition(action, transition, rules) {
	if (transition === 'instant') {
		return { fadeInSeconds: 0, fadeOutSeconds: 0, killRetiring: true };
	}
	switch (action) {
		case 'play':
			return { fadeInSeconds: rules.fadeIn, fadeOutSeconds: 0, killRetiring: false };
		case 'stop':
			// Without a fade-out a stop means silence, so a track still fading out from a crossfade is cut as well.
			return { fadeInSeconds: 0, fadeOutSeconds: rules.fadeOut, killRetiring: rules.fadeOut <= 0 };
		case 'change':
			return { fadeInSeconds: rules.crossfade, fadeOutSeconds: rules.crossfade, killRetiring: false };
	}
}
