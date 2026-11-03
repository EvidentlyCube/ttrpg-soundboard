import { MIN_CLIP_MS } from '../logic/clip.js';
import { formatFixed } from './text.js';

/**
 * The math behind a sound's start and end points in its Customize dialog (DESIGN.md §9.7). Everything here works in
 * whole milliseconds, the precision the points have; the dialog shows them as seconds with three decimals.
 */

const SMALL_STEP_MS = 10;
const LARGE_STEP_MS = 100;
const TIME_PATTERN = /^\s*(\d+(?:[.,]\d+)?)\s*s?\s*$/iu;

/** @typedef {'start' | 'end'} Handle */

/**
 * The start point nearest to `ms` that still leaves the minimum length before the end point.
 * @param {number} ms
 * @param {number} endMs
 */
export function clampStart(ms, endMs) {
	return Math.round(Math.min(Math.max(0, ms), endMs - MIN_CLIP_MS));
}

/**
 * The end point nearest to `ms` that leaves the minimum length after the start point and stays within the file.
 * @param {number} ms
 * @param {number} startMs
 * @param {number} durationMs
 */
export function clampEnd(ms, startMs, durationMs) {
	return Math.round(Math.max(Math.min(ms, durationMs), startMs + MIN_CLIP_MS));
}

/**
 * The point at a share of the slider's width.
 * @param {number} share 0 at the left edge, 1 at the right
 * @param {number} durationMs
 */
export function msAt(share, durationMs) {
	return Math.round(Math.min(Math.max(0, share), 1) * durationMs);
}

/**
 * Where a point sits on the slider, as a share of its width.
 * @param {number} ms
 * @param {number} durationMs
 */
export function shareOf(ms, durationMs) {
	return durationMs > 0 ? Math.min(Math.max(0, ms / durationMs), 1) : 0;
}

/**
 * The handle that pressing the slider at `ms` moves: the nearer one, or the start point on a tie.
 * @param {number} ms
 * @param {number} startMs
 * @param {number} endMs
 * @returns {Handle}
 */
export function nearerHandle(ms, startMs, endMs) {
	return Math.abs(ms - startMs) <= Math.abs(ms - endMs) ? 'start' : 'end';
}

/**
 * How far a key moves a handle, or null for keys that don't step.
 * @param {string} key
 * @param {boolean} shift
 */
export function stepFor(key, shift) {
	const step = shift ? LARGE_STEP_MS : SMALL_STEP_MS;
	if (key === 'ArrowRight' || key === 'ArrowUp') {
		return step;
	}
	if (key === 'ArrowLeft' || key === 'ArrowDown') {
		return -step;
	}
	return null;
}

/**
 * The end point to store: null at the end of the file, so a longer replacement file still plays to its end.
 * @param {number} endMs
 * @param {number} durationMs
 * @returns {number | null} seconds
 */
export function toStoredEnd(endMs, durationMs) {
	return endMs >= durationMs ? null : endMs / 1000;
}

/**
 * The stored points as the slider shows them, fitted into the file and kept the minimum length apart.
 * @param {{ startAt: number, endAt: number | null }} points seconds
 * @param {number} durationMs
 * @returns {{ startMs: number, endMs: number }}
 */
export function fromStored({ startAt, endAt }, durationMs) {
	const endMs = endAt === null ? durationMs : Math.min(Math.round(endAt * 1000), durationMs);
	return { startMs: clampStart(Math.round(startAt * 1000), endMs), endMs };
}

/**
 * Where the fades sit on the part that plays, as shares of its length: the fade-in from its start, the fade-out up to
 * its end, and where they overlap. A fade longer than the whole part is flagged instead, since it can never finish.
 * @param {number} clipMs the length that plays
 * @param {number} fadeInMs
 * @param {number} fadeOutMs
 * @returns {{ fadeIn: number, fadeOut: number, overlap: { from: number, share: number } | null, tooLong: boolean }}
 */
export function fadeBands(clipMs, fadeInMs, fadeOutMs) {
	if (clipMs <= 0 || fadeInMs > clipMs || fadeOutMs > clipMs) {
		return { fadeIn: 0, fadeOut: 0, overlap: null, tooLong: clipMs > 0 };
	}
	const overlapMs = fadeInMs + fadeOutMs - clipMs;
	const overlap = overlapMs > 0 ? { from: (clipMs - fadeOutMs) / clipMs, share: overlapMs / clipMs } : null;
	return { fadeIn: fadeInMs / clipMs, fadeOut: fadeOutMs / clipMs, overlap, tooLong: false };
}

/**
 * A point or length in seconds with three decimals, for a field: `4.210`.
 * @param {number} ms
 */
export function toFieldText(ms) {
	return formatFixed(ms / 1000, 3);
}

/**
 * A point or length for reading: `4.210 s`.
 * @param {number} ms
 */
export function formatTime(ms) {
	return `${toFieldText(ms)} s`;
}

/**
 * Reads typed seconds, such as `1.25`, `1,25` or `1.250 s`, as whole milliseconds.
 * @param {string} text
 * @returns {number | null} null when the text is not a number of seconds
 */
export function parseTime(text) {
	const match = TIME_PATTERN.exec(text);
	return match ? Math.round(Number(match[1].replace(',', '.')) * 1000) : null;
}
