/** @typedef {import('./ports.js').BufferHandle} BufferHandle */

/**
 * @typedef {object} CacheEntry
 * @property {Promise<BufferHandle>} promise
 * @property {BufferHandle | null} buffer null while still decoding
 * @property {number} users instances currently playing this buffer
 */

const DEFAULT_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * Decoded sound effects, evicted least recently used first once their memory exceeds the budget (DESIGN.md §7).
 * Buffers that are playing, or still decoding, are never evicted.
 */
export class BufferCache {
	#load;
	#budgetBytes;
	/** Map iteration order doubles as recency: oldest first. @type {Map<string, CacheEntry>} */
	#entries = new Map();

	/**
	 * @param {object} options
	 * @param {(url: string) => Promise<BufferHandle>} options.load
	 * @param {number} [options.budgetBytes]
	 */
	constructor({ load, budgetBytes = DEFAULT_BUDGET_BYTES }) {
		this.#load = load;
		this.#budgetBytes = budgetBytes;
	}

	get totalBytes() {
		let total = 0;
		for (const entry of this.#entries.values()) {
			total += entry.buffer?.memoryBytes ?? 0;
		}
		return total;
	}

	/** @param {string} url */
	has(url) {
		return this.#entries.has(url);
	}

	/**
	 * Resolves with the decoded buffer, loading it on first use. Concurrent requests share one load.
	 * @param {string} url
	 */
	get(url) {
		const existing = this.#touch(url);
		if (existing) {
			return existing.promise;
		}
		/** @type {CacheEntry} */
		const entry = {
			promise: this.#load(url).then(
				(buffer) => {
					entry.buffer = buffer;
					// The caller is about to play it, so it must survive until it can be retained.
					this.#evict(url);
					return buffer;
				},
				(error) => {
					if (this.#entries.get(url) === entry) {
						this.#entries.delete(url);
					}
					throw error;
				},
			),
			buffer: null,
			users: 0,
		};
		this.#entries.set(url, entry);
		return entry.promise;
	}

	/**
	 * Marks the buffer as playing, which protects it from eviction.
	 * @param {string} url
	 */
	retain(url) {
		const entry = this.#touch(url);
		if (entry) {
			entry.users++;
		}
	}

	/** @param {string} url */
	release(url) {
		const entry = this.#entries.get(url);
		if (entry && entry.users > 0) {
			entry.users--;
			this.#evict();
		}
	}

	/**
	 * Drops the buffer, for a file that was deleted or moved, so a new file at its URL is never played from the cache.
	 * @param {string} url
	 */
	forget(url) {
		this.#entries.delete(url);
	}

	/** @param {string} url */
	#touch(url) {
		const entry = this.#entries.get(url);
		if (entry) {
			this.#entries.delete(url);
			this.#entries.set(url, entry);
		}
		return entry;
	}

	/** @param {string} [keepUrl] never evicted by this call */
	#evict(keepUrl) {
		let total = this.totalBytes;
		for (const [url, entry] of this.#entries) {
			if (total <= this.#budgetBytes) {
				return;
			}
			if (entry.buffer && entry.users === 0 && url !== keepUrl) {
				this.#entries.delete(url);
				total -= entry.buffer.memoryBytes;
			}
		}
	}
}
