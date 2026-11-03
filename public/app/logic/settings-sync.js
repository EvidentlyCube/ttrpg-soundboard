/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').Logger} Logger */

const SAVE_DELAY_MS = 500;

/**
 * Saves one setting of the soundboard, the volumes or the name, to the server (DESIGN.md §6.4): debounced while it
 * changes, one request at a time so saves cannot arrive out of order, and flushed immediately when the page is closing.
 * @template T
 */
export class SettingsSync {
	#save;
	#what;
	#clock;
	#logger;
	/** Wrapped, since null can be a value to save. @type {{ value: T } | null} */
	#pending = null;
	/** @type {number | null} */
	#timer = null;
	/** The save in flight. @type {Promise<void> | null} */
	#saving = null;

	/**
	 * @param {object} options
	 * @param {(value: T, options: { keepalive: boolean }) => Promise<void>} options.save
	 * @param {string} options.what named in the warning when a save fails
	 * @param {Clock} options.clock
	 * @param {Logger} options.logger
	 */
	constructor({ save, what, clock, logger }) {
		this.#save = save;
		this.#what = what;
		this.#clock = clock;
		this.#logger = logger;
	}

	/** @param {T} value the full, current value, not changed afterwards */
	schedule(value) {
		this.#pending = { value };
		this.#cancelTimer();
		this.#timer = this.#clock.setTimeout(() => {
			this.#timer = null;
			this.#drain();
		}, SAVE_DELAY_MS);
	}

	/**
	 * Sends a pending change right away. Used when the page is being closed, so it does not wait for a save in flight.
	 */
	flush() {
		this.#cancelTimer();
		const pending = this.#pending;
		if (pending) {
			this.#pending = null;
			this.#send(pending.value, true);
		}
	}

	/**
	 * Saves a pending change now and resolves once nothing is waiting or in flight, e.g. before the server rebuilds its
	 * library from the files. A failed save is logged as usual and doesn't reject.
	 */
	async settle() {
		this.#cancelTimer();
		this.#drain();
		while (this.#saving) {
			await this.#saving;
		}
	}

	#drain() {
		const pending = this.#pending;
		if (this.#saving || !pending) {
			return;
		}
		this.#pending = null;
		this.#saving = this.#send(pending.value, false).finally(() => {
			this.#saving = null;
			this.#drain();
		});
	}

	/**
	 * @param {T} value
	 * @param {boolean} keepalive
	 */
	#send(value, keepalive) {
		return this.#save(value, { keepalive }).catch((error) => {
			this.#logger.warn(`Could not save the ${this.#what}; it will be saved with the next change.`, error);
		});
	}

	#cancelTimer() {
		if (this.#timer !== null) {
			this.#clock.clearTimeout(this.#timer);
			this.#timer = null;
		}
	}
}
