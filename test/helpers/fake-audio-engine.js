/** @typedef {import('../../public/app/logic/ports.js').AudioEngine} AudioEngine */
/** @typedef {import('../../public/app/logic/ports.js').Voice} Voice */
/** @typedef {import('../../public/app/logic/ports.js').Bus} Bus */
/** @typedef {import('../../public/app/logic/ports.js').AudioFormat} AudioFormat */
/** @typedef {import('./fake-clock.js').FakeClock} FakeClock */

/**
 * How a URL behaves when played. Times are in seconds.
 * @typedef {object} VoiceScript
 * @property {number} [duration]
 * @property {number} [loadDelay] until `loaded`, or until `error` when `loadError` is set
 * @property {string} [loadError]
 * @property {string} [playError] `play()` fails with this, like a rejected media element promise
 * @property {number} [bufferBytes] memory a decoded buffer of this URL takes
 * @property {string} [bufferError] `loadBuffer` rejects with this
 * @property {boolean} [leaky] events keep firing after `stop()`, to prove the player ignores stale callbacks
 */

const DEFAULT_SCRIPT = { duration: 180, loadDelay: 0.1, bufferBytes: 1000 };

/**
 * An audio engine driven by a fake clock, modelling how media elements behave: loading takes time, `play()` before
 * loading waits for it, position only advances while playing, and `ended` fires once.
 * @implements {AudioEngine}
 */
export class FakeAudioEngine {
	unlockCount = 0;
	/** @type {Partial<Record<Bus, number>>} */
	busGains = {};
	/** @type {FakeVoice[]} */
	voices = [];
	/** @type {string[]} */
	bufferLoads = [];
	#clock;
	#canPlay;
	/** @type {Map<string, VoiceScript>} */
	#scripts = new Map();
	/** @type {VoiceScript} */
	#defaultScript;
	/** @type {Record<'suspended' | 'resumed', (() => void)[]>} */
	#handlers = { suspended: [], resumed: [] };

	/**
	 * @param {FakeClock} clock
	 * @param {{ canPlay?: (format: AudioFormat) => boolean, defaultScript?: VoiceScript }} [options]
	 */
	constructor(clock, { canPlay = () => true, defaultScript = {} } = {}) {
		this.#clock = clock;
		this.#canPlay = canPlay;
		this.#defaultScript = { ...DEFAULT_SCRIPT, ...defaultScript };
	}

	/**
	 * @param {string} url
	 * @param {VoiceScript} script
	 */
	script(url, script) {
		this.#scripts.set(url, script);
	}

	/** @param {'suspended' | 'resumed'} type */
	simulate(type) {
		for (const handler of this.#handlers[type]) {
			handler();
		}
	}

	get liveVoices() {
		return this.voices.filter((voice) => !voice.stopped);
	}

	/** @param {Bus} bus */
	liveVoicesOn(bus) {
		return this.liveVoices.filter((voice) => voice.bus === bus);
	}

	unlock() {
		this.unlockCount++;
	}

	/** @type {AudioEngine['on']} */
	on(type, handler) {
		this.#handlers[type].push(handler);
	}

	/** @param {AudioFormat} format */
	canPlay(format) {
		return this.#canPlay(format);
	}

	/**
	 * @param {Bus} bus
	 * @param {number} gain
	 */
	setBusGain(bus, gain) {
		this.busGains[bus] = gain;
	}

	/** @param {{ url: string, bus: Bus }} options */
	createStreamVoice({ url, bus }) {
		return this.#addVoice(new FakeVoice(this.#clock, url, bus, 'stream', this.#scriptFor(url)));
	}

	/** @param {string} url */
	loadBuffer(url) {
		this.bufferLoads.push(url);
		const script = this.#scriptFor(url);
		return new Promise((resolve, reject) => {
			this.#clock.setTimeout(() => {
				if (script.bufferError) {
					reject(new Error(script.bufferError));
				} else {
					resolve(/** @type {import('../../public/app/logic/ports.js').BufferHandle} */ ({ url, memoryBytes: script.bufferBytes ?? 0 }));
				}
			}, (script.loadDelay ?? 0) * 1000);
		});
	}

	/** @param {{ buffer: import('../../public/app/logic/ports.js').BufferHandle, bus: Bus }} options */
	createBufferVoice({ buffer, bus }) {
		const { url } = /** @type {{ url: string }} */ (/** @type {unknown} */ (buffer));
		return this.#addVoice(new FakeVoice(this.#clock, url, bus, 'buffer', { ...this.#scriptFor(url), loadDelay: 0 }));
	}

	/** @param {FakeVoice} voice */
	#addVoice(voice) {
		this.voices.push(voice);
		return voice;
	}

	/** @param {string} url */
	#scriptFor(url) {
		return { ...this.#defaultScript, ...this.#scripts.get(url) };
	}
}

/** @implements {Voice} */
export class FakeVoice {
	stopped = false;
	playCalls = 0;
	/** @type {[number, number][]} */
	gainRamps = [];
	#clock;
	#script;
	#loaded = false;
	#playing = false;
	#ended = false;
	#position = 0;
	#startedAt = 0;
	/** @type {number[]} */
	#timers = [];
	/** @type {number | null} */
	#endTimer = null;
	/** @type {{ loaded: (() => void)[], ended: (() => void)[], error: ((error: { message: string }) => void)[] }} */
	#handlers = { loaded: [], ended: [], error: [] };

	/**
	 * @param {FakeClock} clock
	 * @param {string} url
	 * @param {Bus} bus
	 * @param {'stream' | 'buffer'} kind
	 * @param {VoiceScript} script
	 */
	constructor(clock, url, bus, kind, script) {
		this.#clock = clock;
		this.url = url;
		this.bus = bus;
		this.kind = kind;
		this.#script = script;
		this.#later(() => (script.loadError ? this.#fail(script.loadError) : this.#load()), script.loadDelay ?? 0);
	}

	get loaded() {
		return this.#loaded;
	}

	get playing() {
		return this.#playing;
	}

	get duration() {
		return this.#loaded ? this.#script.duration ?? 0 : Number.NaN;
	}

	get position() {
		if (!this.#playing || !this.#loaded) {
			return this.#position;
		}
		return Math.min(this.duration, this.#position + (this.#clock.now() - this.#startedAt) / 1000);
	}

	play() {
		if (this.stopped && !this.#script.leaky) {
			return;
		}
		this.playCalls++;
		if (this.#script.playError) {
			const message = this.#script.playError;
			this.#later(() => this.#fail(message), 0);
			return;
		}
		if (this.#playing) {
			return;
		}
		this.#playing = true;
		if (this.#loaded) {
			this.#startedAt = this.#clock.now();
			this.#scheduleEnd();
		}
	}

	pause() {
		if (!this.#playing) {
			return;
		}
		this.#position = this.position;
		this.#playing = false;
		this.#clearEnd();
	}

	stop() {
		this.stopped = true;
		this.#position = this.position;
		this.#playing = false;
		if (!this.#script.leaky) {
			for (const timer of this.#timers) {
				this.#clock.clearTimeout(timer);
			}
			this.#clearEnd();
		}
	}

	/** @param {number} seconds */
	seek(seconds) {
		this.#position = this.#loaded ? Math.min(Math.max(0, seconds), this.duration) : Math.max(0, seconds);
		if (this.#playing && this.#loaded) {
			this.#startedAt = this.#clock.now();
			this.#scheduleEnd();
		}
	}

	/**
	 * @param {number} target
	 * @param {number} seconds
	 */
	rampGain(target, seconds) {
		this.gainRamps.push([target, seconds]);
	}

	/**
	 * @param {'loaded' | 'ended'} type
	 * @param {() => void} handler
	 */
	on(type, handler) {
		this.#handlers[type].push(handler);
	}

	/** @param {(error: { message: string }) => void} handler */
	onError(handler) {
		this.#handlers.error.push(handler);
	}

	/**
	 * Fails the voice mid-playback, like a network drop.
	 * @param {string} message
	 */
	fail(message) {
		this.#fail(message);
	}

	#load() {
		this.#loaded = true;
		this.#position = Math.min(this.#position, this.duration);
		if (this.#playing) {
			this.#startedAt = this.#clock.now();
			this.#scheduleEnd();
		}
		this.#notify(this.#handlers.loaded);
	}

	/** @param {string} message */
	#fail(message) {
		this.#playing = false;
		this.#clearEnd();
		this.#notify(this.#handlers.error, { message });
	}

	#scheduleEnd() {
		this.#clearEnd();
		const remaining = Math.max(0, this.duration - this.#position);
		this.#endTimer = this.#clock.setTimeout(() => {
			this.#endTimer = null;
			this.#position = this.duration;
			this.#playing = false;
			if (!this.#ended) {
				this.#ended = true;
				this.#notify(this.#handlers.ended);
			}
		}, remaining * 1000);
	}

	#clearEnd() {
		if (this.#endTimer !== null) {
			this.#clock.clearTimeout(this.#endTimer);
			this.#endTimer = null;
		}
	}

	/**
	 * @param {() => void} callback
	 * @param {number} seconds
	 */
	#later(callback, seconds) {
		this.#timers.push(this.#clock.setTimeout(callback, seconds * 1000));
	}

	/**
	 * @template {unknown[]} A
	 * @param {((...args: A) => void)[]} handlers
	 * @param {A} args
	 */
	#notify(handlers, ...args) {
		if (this.stopped && !this.#script.leaky) {
			return;
		}
		for (const handler of handlers) {
			handler(...args);
		}
	}
}
