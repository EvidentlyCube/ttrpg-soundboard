/** @typedef {import('../../public/app/logic/ports.js').Clock} Clock */

/**
 * A clock that only moves when a test calls `advance`. Timers fire in time order, so tests can step through
 * playback deterministically.
 * @implements {Clock}
 */
export class FakeClock {
	#now = 0;
	#nextId = 1;
	/** @type {Map<number, { at: number, callback: () => void, interval: number | null }>} */
	#timers = new Map();

	/** @returns {number} milliseconds since the clock was created */
	now() {
		return this.#now;
	}

	/**
	 * @param {() => void} callback
	 * @param {number} milliseconds
	 */
	setTimeout(callback, milliseconds) {
		return this.#add(callback, milliseconds, null);
	}

	/** @param {number} id */
	clearTimeout(id) {
		this.#timers.delete(id);
	}

	/**
	 * @param {() => void} callback
	 * @param {number} milliseconds
	 */
	setInterval(callback, milliseconds) {
		return this.#add(callback, milliseconds, Math.max(1, milliseconds));
	}

	/** @param {number} id */
	clearInterval(id) {
		this.#timers.delete(id);
	}

	get pendingTimerCount() {
		return this.#timers.size;
	}

	/**
	 * Moves time forward, firing every timer that comes due, including timers created by other timers.
	 * @param {number} milliseconds
	 */
	advance(milliseconds) {
		const target = this.#now + milliseconds;
		for (;;) {
			const due = this.#nextDue(target);
			if (due === null) {
				break;
			}
			const [id, timer] = due;
			this.#now = timer.at;
			if (timer.interval === null) {
				this.#timers.delete(id);
			} else {
				timer.at += timer.interval;
			}
			timer.callback();
		}
		this.#now = target;
	}

	/**
	 * @param {() => void} callback
	 * @param {number} milliseconds
	 * @param {number | null} interval
	 */
	#add(callback, milliseconds, interval) {
		const id = this.#nextId++;
		this.#timers.set(id, { at: this.#now + Math.max(0, milliseconds), callback, interval });
		return id;
	}

	/** @param {number} target */
	#nextDue(target) {
		/** @type {[number, { at: number, callback: () => void, interval: number | null }] | null} */
		let earliest = null;
		for (const entry of this.#timers) {
			if (entry[1].at <= target && (earliest === null || entry[1].at < earliest[1].at)) {
				earliest = entry;
			}
		}
		return earliest;
	}
}
