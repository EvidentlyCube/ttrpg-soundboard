import { MAX_CROSSFADE } from '../logic/playback-rules.js';

/** The slider covers the crossfades nearly everyone uses; longer ones are typed. */
const SLIDER_MAX = 10;
export const SLIDER_STEP = 0.5;

const SECONDS_PATTERN = /^\s*(\d+(?:[.,]\d+)?)\s*s?\s*$/iu;

/**
 * The longest crossfade the dialog offers: at most half of the playlist's shortest track whose duration is known
 * (DESIGN.md §9.7). The slider stops at its own maximum and on a whole step; the typed value only at the limit.
 * @param {{ duration: number | null }[]} tracks
 * @returns {{ slider: number, field: number }}
 */
export function crossfadeLimits(tracks) {
	const halves = tracks.flatMap(({ duration }) => (duration === null ? [] : [duration / 2]));
	const field = Math.min(MAX_CROSSFADE, ...halves);
	const slider = Math.floor(Math.min(SLIDER_MAX, field) / SLIDER_STEP) * SLIDER_STEP;
	return { slider, field: Math.floor(field * 100) / 100 };
}

/**
 * `Off`, or seconds with one decimal: `2.5 s`.
 * @param {number} seconds
 */
export function formatSeconds(seconds) {
	return seconds <= 0 ? 'Off' : `${seconds.toFixed(1)} s`;
}

/**
 * Reads a typed crossfade, such as `2.5`, `3,5 s` or `off`.
 * @param {string} text
 * @returns {number | null} null when the text is not a duration
 */
export function parseSeconds(text) {
	if (text.trim().toLowerCase() === 'off') {
		return 0;
	}
	const match = SECONDS_PATTERN.exec(text);
	return match ? Number(match[1].replace(',', '.')) : null;
}
