/** @typedef {import('./ports.js').BackendApi} BackendApi */
/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').Logger} Logger */
/** @typedef {import('./ports.js').WaveformDecoder} WaveformDecoder */

/**
 * `total` is the number of waveforms missing when generation last started; `done` counts those finished or failed.
 * @typedef {{ running: boolean, done: number, total: number, failed: number }} WaveformStatus
 */
/**
 * @typedef {{ type: 'waveforms.progress', status: WaveformStatus }
 * 	| { type: 'waveform.ready', id: string }} WaveformEvent
 */

/** A rest between files, so decoding never keeps the browser busy back to back. */
const PAUSE_MS = 250;

/**
 * Generates the waveforms the server is missing, one file at a time, and serves the stored ones (DESIGN.md §6.6).
 * It knows nothing about playback.
 */
export class WaveformService {
	#api;
	#decoder;
	#clock;
	#logger;
	#emit;
	#urlOf;
	/** @type {Map<string, Promise<Int8Array | null>>} */
	#cache = new Map();
	/** Incremented by every start and stop; a run whose number is out of date quietly ends. */
	#run = 0;
	/** @type {WaveformStatus} */
	#status = { running: false, done: 0, total: 0, failed: 0 };

	/**
	 * @param {object} options
	 * @param {BackendApi} options.api
	 * @param {WaveformDecoder} options.decoder
	 * @param {Clock} options.clock
	 * @param {Logger} options.logger
	 * @param {(event: WaveformEvent) => void} options.emit
	 * @param {(id: string) => string | undefined} options.urlOf the media URL of a sound or track
	 */
	constructor({ api, decoder, clock, logger, emit, urlOf }) {
		this.#api = api;
		this.#decoder = decoder;
		this.#clock = clock;
		this.#logger = logger;
		this.#emit = emit;
		this.#urlOf = urlOf;
	}

	/** @returns {WaveformStatus} */
	get status() {
		return { ...this.#status };
	}

	/** Asks the server what is missing and generates it. Does nothing while already running. */
	start() {
		if (this.#status.running) {
			return;
		}
		this.#status = { running: true, done: 0, total: 0, failed: 0 };
		this.#emitProgress();
		void this.#generate(++this.#run);
	}

	/** Ends generation after the file being decoded; its result is dropped. */
	stop() {
		if (!this.#status.running) {
			return;
		}
		this.#run++;
		this.#status.running = false;
		this.#emitProgress();
	}

	/**
	 * @param {string} id
	 * @returns {Promise<Int8Array | null>} the peaks, or null when the server has none yet
	 */
	get(id) {
		let promise = this.#cache.get(id);
		if (!promise) {
			promise = this.#api.fetchWaveform(id).catch((error) => {
				this.#logger.warn(`Could not load the waveform of ${id}`, error);
				return null;
			});
			this.#cache.set(id, promise);
			void promise.then((peaks) => {
				if (peaks === null && this.#cache.get(id) === promise) {
					this.#cache.delete(id);
				}
			});
		}
		return promise;
	}

	/** @param {number} run */
	async #generate(run) {
		let ids;
		try {
			ids = await this.#api.fetchMissingWaveforms();
		} catch (error) {
			this.#logger.warn('Could not ask the server which waveforms are missing', error);
			if (run === this.#run) {
				this.#status.running = false;
				this.#emitProgress();
			}
			return;
		}
		if (run !== this.#run) {
			return;
		}
		this.#status.total = ids.length;
		this.#emitProgress();

		for (const id of ids) {
			try {
				await this.#generateOne(id, run);
			} catch (error) {
				this.#logger.warn(`Could not make the waveform of ${id}`, error);
				if (run === this.#run) {
					this.#status.failed++;
				}
			}
			if (run !== this.#run) {
				return;
			}
			this.#status.done++;
			this.#emitProgress();
			await new Promise((resolve) => this.#clock.setTimeout(() => resolve(undefined), PAUSE_MS));
			if (run !== this.#run) {
				return;
			}
		}
		this.#status.running = false;
		this.#emitProgress();
	}

	/**
	 * @param {string} id
	 * @param {number} run
	 */
	async #generateOne(id, run) {
		const url = this.#urlOf(id);
		if (url === undefined) {
			throw new Error('Not in the library');
		}
		const peaks = await this.#decoder.decode(url);
		if (run !== this.#run) {
			return;
		}
		await this.#api.saveWaveform(id, peaks);
		this.#cache.set(id, Promise.resolve(peaks));
		this.#emit({ type: 'waveform.ready', id });
	}

	#emitProgress() {
		this.#emit({ type: 'waveforms.progress', status: this.status });
	}
}
