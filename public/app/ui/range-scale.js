import { MIN_CLIP_MS } from '../logic/clip.js';

/**
 * The math behind a sound's start and end points in its Customize dialog (DESIGN.md §9.7). Everything here is in whole
 * milliseconds, the unit the dialog shows; the library stores seconds.
 */

const SMALL_STEP_MS = 10;
const LARGE_STEP_MS = 100;
const MS_PATTERN = /^\s*(\d{1,3}(?:[ ,]\d{3})+|\d+)\s*(?:ms)?\s*$/iu;

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
 * `4,210 ms`.
 * @param {number} ms
 */
export function formatMs(ms) {
	return `${ms.toLocaleString('en-US')} ms`;
}

/**
 * Reads typed milliseconds, such as `1250`, `1,250` or `1 250 ms`.
 * @param {string} text
 * @returns {number | null} null when the text is not a whole number of milliseconds
 */
export function parseMs(text) {
	const match = MS_PATTERN.exec(text);
	return match ? Number(match[1].replaceAll(/[ ,]/gu, '')) : null;
}
