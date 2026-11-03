import { MAX_CROSSFADE } from '../logic/playback-rules.js';
import { formatFixed, t } from './text.js';

/** The slider covers the fades and crossfades nearly everyone uses; longer ones are typed. */
const SLIDER_MAX = 10;
export const SLIDER_STEP = 0.1;

/** @typedef {{ slider: number, field: number }} SecondsLimits the highest value of the slider and of the typed field */

/** Fades are not limited by track lengths. @type {Readonly<SecondsLimits>} */
export const SECONDS_LIMITS = Object.freeze({ slider: SLIDER_MAX, field: MAX_CROSSFADE });

const SECONDS_PATTERN = /^\s*(\d+(?:[.,]\d+)?)\s*s?\s*$/iu;

/**
 * The longest crossfade the dialog offers: at most half of the playlist's shortest track whose duration is known
 * (DESIGN.md §9.7). The slider stops at its own maximum and on a whole step; the typed value only at the limit.
 * @param {{ duration: number | null }[]} tracks
 * @returns {SecondsLimits}
 */
export function crossfadeLimits(tracks) {
	const halves = tracks.flatMap(({ duration }) => (duration === null ? [] : [duration / 2]));
	const field = Math.min(MAX_CROSSFADE, ...halves);
	// The tolerance and the final rounding keep floating-point noise (0.3 / 0.1 = 2.999…) from costing a whole step.
	const steps = Math.floor(Math.min(SLIDER_MAX, field) / SLIDER_STEP + 1e-9);
	const slider = Math.round(steps * SLIDER_STEP * 100) / 100;
	return { slider, field: Math.floor(field * 100) / 100 };
}

/**
 * `Off`, or seconds with three decimals: `2.500 s`.
 * @param {number} seconds
 */
export function formatSeconds(seconds) {
	return seconds <= 0 ? t('common.off') : `${formatFixed(seconds, 3)} s`;
}

/**
 * Reads a typed crossfade, such as `2.5`, `3,5 s` or `off`.
 * @param {string} text
 * @returns {number | null} null when the text is not a duration
 */
export function parseSeconds(text) {
	const typed = text.trim().toLowerCase();
	if (typed === 'off' || typed === t('common.off').toLowerCase()) {
		return 0;
	}
	const match = SECONDS_PATTERN.exec(text);
	return match ? Number(match[1].replace(',', '.')) : null;
}
