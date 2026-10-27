import { orderStrategy } from './order-strategies.js';

/** @typedef {import('./order-strategies.js').PlaybackOrder} PlaybackOrder */

/** Far more than any playlist will play in one session, and still only a few hundred kilobytes. */
export const MAX_HISTORY = 2 ** 16;

/**
 * The tracks a playlist has played and will play, with a cursor at the current one (DESIGN.md §8.1). Next and Previous
 * move the cursor; past the end, the playlist's order appends more entries. Upcoming tracks are entries too, so
 * everything that asks what plays next gets the same answer.
 */
export class PlayHistory {
	#trackCount;
	#random;
	#loop;
	#maxLength;
	#strategy;
	/** Track indices. @type {number[]} */
	#entries = [];
	#cursor = 0;

	/**
	 * @param {object} options
	 * @param {number} options.trackCount
	 * @param {PlaybackOrder} options.order
	 * @param {() => number} options.random
	 * @param {boolean} [options.loop] whether the history is extended once its first entries run out
	 * @param {number} [options.maxLength]
	 */
	constructor({ trackCount, order, random, loop = true, maxLength = MAX_HISTORY }) {
		this.#trackCount = trackCount;
		this.#random = random;
		this.#loop = loop;
		this.#maxLength = maxLength;
		this.#strategy = orderStrategy(order);
	}

	/** @returns {number | null} the current track, or null before the playlist starts */
	get current() {
		return this.#entries[this.#cursor] ?? null;
	}

	get canGoBack() {
		return this.#cursor > 0;
	}

	get length() {
		return this.#entries.length;
	}

	/**
	 * Starts a fresh history, as the order fills it; `at` is a track to start at instead of the order's own choice.
	 * @param {number | null} [at]
	 * @returns {number | null} the track to play
	 */
	start(at = null) {
		const { entries, cursor } = this.#strategy.start(this.#trackCount, this.#random, at);
		this.#entries = entries;
		this.#cursor = cursor;
		return this.current;
	}

	/**
	 * The track `next()` would move to, appending more entries first if the history has run out.
	 * @returns {number | null} null when there is nothing more to play
	 */
	upcoming() {
		if (this.#cursor + 1 >= this.#entries.length && this.#loop && this.#entries.length > 0) {
			this.#entries.push(...this.#strategy.extend(this.#trackCount, this.#random, /** @type {number} */ (this.#entries.at(-1))));
		}
		return this.#entries[this.#cursor + 1] ?? null;
	}

	/** @returns {number | null} the track moved to, or null when there is nothing more to play */
	next() {
		const upcoming = this.upcoming();
		if (upcoming === null) {
			return null;
		}
		this.#cursor++;
		this.#trim();
		return upcoming;
	}

	/** @returns {number | null} the track moved back to, or null at the first entry */
	previous() {
		if (!this.canGoBack) {
			return null;
		}
		this.#cursor--;
		return this.current;
	}

	/**
	 * Switches to another order. Once the playlist has started, the history is refilled by the new order as if the
	 * current track had just been chosen; it keeps playing.
	 * @param {PlaybackOrder} order
	 */
	setOrder(order) {
		this.#strategy = orderStrategy(order);
		const current = this.current;
		if (current !== null) {
			this.start(current);
		}
	}

	/** Drops the oldest entries, but only ones before the cursor, so the current and upcoming tracks are kept. */
	#trim() {
		const excess = Math.min(this.#entries.length - this.#maxLength, this.#cursor);
		if (excess > 0) {
			this.#entries.splice(0, excess);
			this.#cursor -= excess;
		}
	}
}
