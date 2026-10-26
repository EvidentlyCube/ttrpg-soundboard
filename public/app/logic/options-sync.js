/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').ItemOptions} ItemOptions */

/**
 * Which item's options are saved. Sounds, playlists and tracks have separate ids, so an id alone is not enough.
 * @typedef {{ kind: 'sound' | 'playlist' | 'track', id: string }} ItemRef
 */

const SAVE_DELAY_MS = 500;

/**
 * @typedef {object} Entry
 * @property {ItemRef} item
 * @property {ItemOptions | null} pending the latest options not yet sent
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
	 * @param {(item: ItemRef, options: ItemOptions, request: { keepalive: boolean }) => Promise<void>} options.save
	 * @param {Clock} options.clock
	 * @param {(item: ItemRef) => void} options.onSaved called once nothing more is waiting to be saved for that item
	 * @param {(item: ItemRef, error: Error) => void} options.onFailed
	 */
	constructor({ save, clock, onSaved, onFailed }) {
		this.#save = save;
		this.#clock = clock;
		this.#onSaved = onSaved;
		this.#onFailed = onFailed;
	}

	/**
	 * @param {ItemRef} item
	 * @param {ItemOptions} options the item's full, current options
	 */
	schedule(item, options) {
		const entry = this.#entry(item);
		entry.pending = { ...options };
		this.#cancelTimer(entry);
		entry.timer = this.#clock.setTimeout(() => {
			entry.timer = null;
			this.#drain(entry);
		}, SAVE_DELAY_MS);
	}

	/**
	 * Saves the item's pending change now, though still after a save of it that is already in flight.
	 * @param {ItemRef} item
	 */
	flush(item) {
		const entry = this.#entries.get(keyOf(item));
		if (entry) {
			this.#cancelTimer(entry);
			this.#drain(entry);
		}
	}

	/** Sends every pending change at once with keepalive, because the page is closing and cannot wait. */
	flushAll() {
		for (const entry of this.#entries.values()) {
			this.#cancelTimer(entry);
			const options = entry.pending;
			if (options) {
				entry.pending = null;
				this.#send(entry.item, options, true);
			}
		}
	}

	/** @param {Entry} entry */
	#drain(entry) {
		const options = entry.pending;
		if (entry.saving || !options) {
			return;
		}
		entry.pending = null;
		entry.saving = true;
		this.#send(entry.item, options, false).then((succeeded) => {
			entry.saving = false;
			if (succeeded && !entry.pending) {
				this.#onSaved(entry.item);
			} else if (entry.timer === null) {
				this.#drain(entry);
			}
		});
	}

	/**
	 * @param {ItemRef} item
	 * @param {ItemOptions} options
	 * @param {boolean} keepalive
	 * @returns {Promise<boolean>} whether it was saved; failures are reported, never thrown
	 */
	#send(item, options, keepalive) {
		return this.#save(item, options, { keepalive }).then(
			() => true,
			(error) => {
				this.#onFailed(item, error instanceof Error ? error : new Error(String(error)));
				return false;
			},
		);
	}

	/** @param {ItemRef} item */
	#entry(item) {
		const key = keyOf(item);
		let entry = this.#entries.get(key);
		if (!entry) {
			entry = { item: { ...item }, pending: null, timer: null, saving: false };
			this.#entries.set(key, entry);
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

/** @param {ItemRef} item */
function keyOf({ kind, id }) {
	return `${kind}/${id}`;
}
