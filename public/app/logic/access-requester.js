/** @typedef {import('./ports.js').Clock} Clock */

/** How often the phone asks whether its request was answered. */
export const POLL_MS = 1000;

/**
 * What the server says about this device's pairing request (DESIGN.md §5.2). `none` after a request means it expired.
 * @typedef {{ status: 'none' | 'banned' } | { status: 'pending' | 'allowed' | 'denied', code: string }} PairingAnswer
 */

/**
 * The server's pairing routes, as the connect page uses them.
 * @typedef {object} ConnectApi
 * @property {() => Promise<PairingAnswer>} request asks to be paired; a second call from the same address gets the same code
 * @property {() => Promise<PairingAnswer>} poll the current answer
 */

/**
 * @typedef {object} RequesterState
 * @property {'starting' | 'pending' | 'allowed' | 'denied' | 'expired' | 'banned'} phase
 * @property {string | null} code
 */

/**
 * The connect page's small state machine (DESIGN.md §9.16): asks to be paired, shows the code while waiting, and says
 * how it ended. It stops asking once it has an answer, and starts over with `start()`.
 */
export class AccessRequester {
	#api;
	#clock;
	#onChange;
	/** @type {RequesterState} */
	#state = { phase: 'starting', code: null };
	/** @type {number | null} */
	#timer = null;
	/** Whether the request that is running now is the current one; a restart makes older answers stale. */
	#generation = 0;

	/**
	 * @param {{ api: ConnectApi, clock: Clock, onChange: (state: RequesterState) => void }} options
	 */
	constructor({ api, clock, onChange }) {
		this.#api = api;
		this.#clock = clock;
		this.#onChange = onChange;
	}

	/** @returns {RequesterState} */
	get state() {
		return this.#state;
	}

	/** Asks to be paired, then polls until there is an answer. */
	start() {
		this.stop();
		const generation = ++this.#generation;
		this.#set({ phase: 'starting', code: null });
		this.#api.request().then(
			(answer) => {
				if (generation === this.#generation && this.#apply(answer, { expectRequest: true })) {
					this.#timer = this.#clock.setInterval(() => this.#poll(generation), POLL_MS);
				}
			},
			() => {
				// The server may be busy or restarting; asking again is all there is to do.
				if (generation === this.#generation) {
					this.#timer = this.#clock.setInterval(() => this.#poll(generation), POLL_MS);
				}
			},
		);
	}

	stop() {
		this.#generation++;
		if (this.#timer !== null) {
			this.#clock.clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	/** @param {number} generation */
	#poll(generation) {
		this.#api.poll().then(
			(answer) => {
				if (generation === this.#generation && !this.#apply(answer, { expectRequest: false })) {
					this.#finish();
				}
			},
			() => {},
		);
	}

	#finish() {
		if (this.#timer !== null) {
			this.#clock.clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	/**
	 * @param {PairingAnswer} answer
	 * @param {{ expectRequest: boolean }} options
	 * @returns {boolean} whether to keep asking
	 */
	#apply(answer, { expectRequest }) {
		switch (answer.status) {
			case 'pending':
				this.#set({ phase: 'pending', code: answer.code });
				return true;
			case 'allowed':
			case 'denied':
				this.#set({ phase: answer.status, code: answer.code });
				return false;
			case 'banned':
				this.#set({ phase: 'banned', code: null });
				return false;
			case 'none':
				// Right after asking this can't be; later it means the request ran out.
				if (expectRequest) {
					return true;
				}
				this.#set({ phase: 'expired', code: null });
				return false;
		}
	}

	/** @param {RequesterState} state */
	#set(state) {
		this.#state = state;
		this.#onChange(state);
	}
}
