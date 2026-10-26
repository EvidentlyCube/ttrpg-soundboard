/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').SoundOptions} SoundOptions */

const SAVE_DELAY_MS = 500;

/**
 * @typedef {object} Entry
 * @property {SoundOptions | null} pending the latest options not yet sent
 * @property {number | null} timer
 * @property {boolean} saving
 */

/**
 * Saves item options to the server, like `SettingsSync` does for volumes but per item: each item's changes are
 * debounced, one request per item is in flight at a time so its saves cannot arrive out of order, and everything is
 * sent at once when the page closes. The full options are sent every time, so a failed save is repaired by the next.
 */
export class OptionsSync {
	#save;
	#clock;
	#onSaved;
	#onFailed;
	/** @type {Map<string, Entry>} */
	#entries = new Map();

	/**
	 * @param {object} options
	 * @param {(id: string, options: SoundOptions, request: { keepalive: boolean }) => Promise<void>} options.save
	 * @param {Clock} options.clock
	 * @param {(id: string) => void} options.onSaved called once nothing more is waiting to be saved for that item
	 * @param {(id: string, error: Error) => void} options.onFailed
	 */
	constructor({ save, clock, onSaved, onFailed }) {
		this.#save = save;
		this.#clock = clock;
		this.#onSaved = onSaved;
		this.#onFailed = onFailed;
	}

	/**
	 * @param {string} id
	 * @param {SoundOptions} options the item's full, current options
	 */
	schedule(id, options) {
		const entry = this.#entry(id);
		entry.pending = { ...options };
		this.#cancelTimer(entry);
		entry.timer = this.#clock.setTimeout(() => {
			entry.timer = null;
			this.#drain(id, entry);
		}, SAVE_DELAY_MS);
	}

	/**
	 * Saves the item's pending change now, though still after a save of it that is already in flight.
	 * @param {string} id
	 */
	flush(id) {
		const entry = this.#entries.get(id);
		if (entry) {
			this.#cancelTimer(entry);
			this.#drain(id, entry);
		}
	}

	/** Sends every pending change at once with keepalive, because the page is closing and cannot wait. */
	flushAll() {
		for (const [id, entry] of this.#entries) {
			this.#cancelTimer(entry);
			const options = entry.pending;
			if (options) {
				entry.pending = null;
				this.#send(id, options, true);
			}
		}
	}

	/**
	 * @param {string} id
	 * @param {Entry} entry
	 */
	#drain(id, entry) {
		const options = entry.pending;
		if (entry.saving || !options) {
			return;
		}
		entry.pending = null;
		entry.saving = true;
		this.#send(id, options, false).then((succeeded) => {
			entry.saving = false;
			if (succeeded && !entry.pending) {
				this.#onSaved(id);
			} else if (entry.timer === null) {
				this.#drain(id, entry);
			}
		});
	}

	/**
	 * @param {string} id
	 * @param {SoundOptions} options
	 * @param {boolean} keepalive
	 * @returns {Promise<boolean>} whether it was saved; failures are reported, never thrown
	 */
	#send(id, options, keepalive) {
		return this.#save(id, options, { keepalive }).then(
			() => true,
			(error) => {
				this.#onFailed(id, error instanceof Error ? error : new Error(String(error)));
				return false;
			},
		);
	}

	/** @param {string} id */
	#entry(id) {
		let entry = this.#entries.get(id);
		if (!entry) {
			entry = { pending: null, timer: null, saving: false };
			this.#entries.set(id, entry);
		}
		return entry;
	}

	/** @param {Entry} entry */
	#cancelTimer(entry) {
		if (entry.timer !== null) {
			this.#clock.clearTimeout(entry.timer);
			entry.timer = null;
		}
	}
}
