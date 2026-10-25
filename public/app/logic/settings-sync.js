/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').Logger} Logger */
/** @typedef {import('./ports.js').Volumes} Volumes */

const SAVE_DELAY_MS = 500;

/**
 * Saves volume changes to the server (DESIGN.md §6.4): debounced while a slider is dragged, one request at a time so
 * saves cannot arrive out of order, and flushed immediately when the page is closing.
 */
export class SettingsSync {
	#saveVolumes;
	#clock;
	#logger;
	/** @type {Volumes | null} */
	#pending = null;
	/** @type {number | null} */
	#timer = null;
	#saving = false;

	/**
	 * @param {object} options
	 * @param {(volumes: Volumes, options: { keepalive: boolean }) => Promise<void>} options.saveVolumes
	 * @param {Clock} options.clock
	 * @param {Logger} options.logger
	 */
	constructor({ saveVolumes, clock, logger }) {
		this.#saveVolumes = saveVolumes;
		this.#clock = clock;
		this.#logger = logger;
	}

	/** @param {Volumes} volumes the full, current set */
	schedule(volumes) {
		this.#pending = { ...volumes };
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
		const volumes = this.#pending;
		if (volumes) {
			this.#pending = null;
			this.#send(volumes, true);
		}
	}

	#drain() {
		const volumes = this.#pending;
		if (this.#saving || !volumes) {
			return;
		}
		this.#pending = null;
		this.#saving = true;
		this.#send(volumes, false).finally(() => {
			this.#saving = false;
			this.#drain();
		});
	}

	/**
	 * @param {Volumes} volumes
	 * @param {boolean} keepalive
	 */
	#send(volumes, keepalive) {
		return this.#saveVolumes(volumes, { keepalive }).catch((error) => {
			this.#logger.warn('Could not save volumes; they will be saved with the next change.', error);
		});
	}

	#cancelTimer() {
		if (this.#timer !== null) {
			this.#clock.clearTimeout(this.#timer);
			this.#timer = null;
		}
	}
}
