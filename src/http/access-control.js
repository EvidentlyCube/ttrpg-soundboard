import { createHash, randomBytes, randomInt } from 'node:crypto';

/** How long a request, and its answer, can wait for the phone to collect it. */
export const REQUEST_LIFETIME_MS = 2 * 60_000;
/** An address that counts more than `MAX_REQUESTS` times within this window is banned. */
export const RATE_WINDOW_MS = 60_000;
export const MAX_REQUESTS = 5;

/**
 * @typedef {object} PendingRequest
 * @property {string} address
 * @property {string} code three digits, different for every pending request
 */

/**
 * @typedef {{ status: 'none' | 'banned' }
 * 	| { status: 'pending' | 'denied', code: string }
 * 	| { status: 'allowed', code: string, secret?: string }} PairingStatus `secret` comes once, with the first poll after
 * 	the answer: it is what the phone keeps in its cookie
 */

/**
 * @typedef {object} Entry
 * @property {string} code
 * @property {'pending' | 'allowed' | 'denied'} state
 * @property {number} at
 * @property {string} [secret] waiting to be handed to the phone
 */

/**
 * @typedef {object} AccessControlOptions
 * @property {() => number} [now] milliseconds
 * @property {(max: number) => number} [randomNumber] an integer below `max`
 * @property {() => string} [randomSecret]
 */

/**
 * Who may use the server from another machine with `--lan` (DESIGN.md §5.6). A device asks to be paired, the person at
 * this machine allows or denies it, and an allowed device gets a secret of its own. An address that asks too often is
 * banned at once. The address is the device's identity. Everything is kept in memory only.
 */
export class AccessControl {
	#now;
	#randomNumber;
	#randomSecret;
	/** @type {Map<string, Entry>} */
	#entries = new Map();
	/** @type {Set<string>} */
	#banned = new Set();
	/** @type {Set<string>} hashes of the secrets of allowed devices */
	#devices = new Set();
	/** @type {Map<string, number[]>} */
	#hits = new Map();
	/** @type {Set<() => void>} */
	#changeListeners = new Set();
	/** @type {Set<(request: PendingRequest) => void>} */
	#requestListeners = new Set();

	/** @param {AccessControlOptions} [options] */
	constructor({ now = Date.now, randomNumber = randomInt, randomSecret = () => randomBytes(16).toString('hex') } = {}) {
		this.#now = now;
		this.#randomNumber = randomNumber;
		this.#randomSecret = randomSecret;
	}

	/**
	 * Starts pairing for an address, or returns the request it already has: a second tab shows the same code. Counts
	 * toward the rate limit.
	 * @param {string} address
	 * @returns {PairingStatus}
	 */
	request(address) {
		const key = normalizeAddress(address);
		if (this.#banned.has(key) || this.strike(key)) {
			return { status: 'banned' };
		}
		const existing = this.#live(key);
		if (existing?.state === 'pending') {
			return { status: 'pending', code: existing.code };
		}
		const entry = { code: this.#freeCode(), state: /** @type {const} */ ('pending'), at: this.#now() };
		this.#entries.set(key, entry);
		this.#changed();
		for (const listener of this.#requestListeners) {
			listener({ address: key, code: entry.code });
		}
		return { status: 'pending', code: entry.code };
	}

	/**
	 * What became of an address's request. Not counted.
	 * @param {string} address
	 * @returns {PairingStatus}
	 */
	status(address) {
		const key = normalizeAddress(address);
		if (this.#banned.has(key)) {
			return { status: 'banned' };
		}
		const entry = this.#live(key);
		if (!entry) {
			return { status: 'none' };
		}
		if (entry.state === 'allowed') {
			const { secret } = entry;
			delete entry.secret;
			return secret === undefined ? { status: 'allowed', code: entry.code } : { status: 'allowed', code: entry.code, secret };
		}
		return { status: entry.state, code: entry.code };
	}

	/**
	 * @param {string} address
	 * @param {'allow' | 'deny'} decision
	 * @returns {boolean} whether there was a pending request to answer
	 */
	answer(address, decision) {
		const key = normalizeAddress(address);
		const entry = this.#live(key);
		if (entry?.state !== 'pending') {
			return false;
		}
		if (decision === 'allow') {
			const secret = this.#randomSecret();
			this.#devices.add(hash(secret));
			entry.state = 'allowed';
			entry.secret = secret;
		} else {
			entry.state = 'denied';
		}
		entry.at = this.#now();
		this.#changed();
		return true;
	}

	/**
	 * Counts one more request of an address; the sixth within a minute bans it.
	 * @param {string} address
	 * @returns {boolean} whether the address is banned now
	 */
	strike(address) {
		const key = normalizeAddress(address);
		if (this.#banned.has(key)) {
			return true;
		}
		const now = this.#now();
		const hits = (this.#hits.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
		hits.push(now);
		this.#hits.set(key, hits);
		if (hits.length <= MAX_REQUESTS) {
			return false;
		}
		this.#banned.add(key);
		this.#hits.delete(key);
		if (this.#entries.delete(key)) {
			this.#changed();
		}
		return true;
	}

	/**
	 * @param {string} address
	 * @returns {boolean}
	 */
	isBanned(address) {
		return this.#banned.has(normalizeAddress(address));
	}

	/**
	 * @param {string} secret what a device's cookie holds
	 * @returns {boolean}
	 */
	isAllowed(secret) {
		return this.#devices.has(hash(secret));
	}

	/** @returns {PendingRequest[]} the requests waiting for an answer, oldest first */
	pending() {
		const result = [];
		for (const address of [...this.#entries.keys()]) {
			const entry = this.#live(address);
			if (entry?.state === 'pending') {
				result.push({ address, code: entry.code });
			}
		}
		return result;
	}

	/**
	 * @param {() => void} listener called when the list of pending requests may have changed
	 * @returns {() => void} unsubscribe
	 */
	onChange(listener) {
		this.#changeListeners.add(listener);
		return () => this.#changeListeners.delete(listener);
	}

	/**
	 * @param {(request: PendingRequest) => void} listener called for every request that is new, not for a second tab
	 * @returns {() => void} unsubscribe
	 */
	onRequest(listener) {
		this.#requestListeners.add(listener);
		return () => this.#requestListeners.delete(listener);
	}

	/**
	 * @param {string} key
	 * @returns {Entry | undefined} the entry, unless it is old enough to be forgotten
	 */
	#live(key) {
		const entry = this.#entries.get(key);
		if (entry && this.#now() - entry.at >= REQUEST_LIFETIME_MS) {
			this.#entries.delete(key);
			if (entry.state === 'pending') {
				this.#changed();
			}
			return undefined;
		}
		return entry;
	}

	#freeCode() {
		const used = new Set([...this.#entries.values()].map((entry) => entry.code));
		for (;;) {
			const code = String(this.#randomNumber(1000)).padStart(3, '0');
			if (!used.has(code)) {
				return code;
			}
		}
	}

	#changed() {
		for (const listener of this.#changeListeners) {
			listener();
		}
	}
}

/**
 * @param {string} address a socket's remote address
 * @returns {string} the same device whether the socket is IPv4 or IPv6-mapped
 */
export function normalizeAddress(address) {
	return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

/** @param {string} secret */
function hash(secret) {
	return createHash('sha256').update(secret).digest('hex');
}
