import { InvalidCommandError } from './errors.js';

/** How much of a sound must stay between its start and end points, in milliseconds; the server checks the same. */
export const MIN_CLIP_MS = 10;

/**
 * Rounds seconds to whole milliseconds, the precision the points are stored and shown with (DESIGN.md §2.3).
 * @param {number} seconds
 */
export function roundToMilliseconds(seconds) {
	return Math.round(seconds * 1000) / 1000;
}

/**
 * Checks a sound's start and end points, already rounded, on their own and against each other.
 * @param {number} startAt seconds
 * @param {number | null} endAt seconds, or null for the end of the file
 * @throws {InvalidCommandError}
 */
export function checkClip(startAt, endAt) {
	if (!(Number.isFinite(startAt) && startAt >= 0)) {
		throw new InvalidCommandError(`The start point must be a non-negative number of seconds, got ${startAt}`);
	}
	if (endAt === null) {
		return;
	}
	if (!(Number.isFinite(endAt) && endAt >= 0)) {
		throw new InvalidCommandError(`The end point must be a non-negative number of seconds, got ${endAt}`);
	}
	// In whole milliseconds, so floating-point noise never turns 10 ms into 9.999….
	if (Math.round(endAt * 1000) - Math.round(startAt * 1000) < MIN_CLIP_MS) {
		throw new InvalidCommandError(`The end point must be at least ${MIN_CLIP_MS} ms after the start point`);
	}
}
