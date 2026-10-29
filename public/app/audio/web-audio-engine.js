import { FULL, rampTo } from '../logic/fade-ramp.js';

/** @typedef {import('../logic/ports.js').AudioEngine} AudioEngine */
/** @typedef {import('../logic/ports.js').AudioFormat} AudioFormat */
/** @typedef {import('../logic/ports.js').BufferHandle} BufferHandle */
/** @typedef {import('../logic/ports.js').Bus} Bus */
/** @typedef {import('../logic/ports.js').Voice} Voice */
/** @typedef {import('../logic/ports.js').VoiceError} VoiceError */
/** @typedef {import('../logic/ports.js').VoiceOptions} VoiceOptions */
/** @typedef {import('../logic/fade-ramp.js').FadeRamp} FadeRamp */

/** @type {Record<AudioFormat, string>} */
const MIME_TYPES = { mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg; codecs=opus' };

/** Short enough to feel immediate, long enough to avoid clicks when a slider moves. */
const GAIN_SMOOTHING_SECONDS = 0.015;

/** A streamed voice this close to its end point counts as having reached it. */
const END_TOLERANCE_SECONDS = 0.005;

/** @typedef {{ startAt: number, endAt: number | null }} Clip the part of the file a voice plays, in seconds */

/**
 * Plays audio through the Web Audio API (DESIGN.md §6.3). The graph is voice gain → voice fade → bus gain → master gain
 * → speakers.
 * The context is only created inside `unlock()`, because browsers only allow audio to start from a user gesture.
 * @implements {AudioEngine}
 */
export class WebAudioEngine {
	/** @type {AudioContext | null} */
	#context = null;
	/** @type {Record<Bus, GainNode> | null} */
	#buses = null;
	/** @type {Record<Bus, number>} */
	#gains = { master: 1, music: 1, sfx: 1 };
	/** @type {Map<AudioFormat, boolean>} */
	#canPlay = new Map();
	/** @type {Record<'suspended' | 'resumed', (() => void)[]>} */
	#handlers = { suspended: [], resumed: [] };
	#wasRunning = false;
	#announcedSuspension = false;

	unlock() {
		const context = this.#context ?? this.#createContext();
		if (context.state !== 'running') {
			// resume() has to be called synchronously inside the gesture; its promise does not need to be awaited.
			context.resume().catch(() => {});
		}
	}

	/** @type {AudioEngine['on']} */
	on(type, handler) {
		this.#handlers[type].push(handler);
	}

	/** @param {AudioFormat} format */
	canPlay(format) {
		let supported = this.#canPlay.get(format);
		if (supported === undefined) {
			supported = document.createElement('audio').canPlayType(MIME_TYPES[format]) !== '';
			this.#canPlay.set(format, supported);
		}
		return supported;
	}

	/**
	 * @param {Bus} bus
	 * @param {number} gain
	 */
	setBusGain(bus, gain) {
		this.#gains[bus] = gain;
		if (this.#context && this.#buses) {
			this.#buses[bus].gain.setTargetAtTime(gain, this.#context.currentTime, GAIN_SMOOTHING_SECONDS);
		}
	}

	/** @param {VoiceOptions & { url: string }} options */
	createStreamVoice({ url, bus, gain = 1, startAt = 0, endAt = null }) {
		const { context, buses } = this.#unlocked();
		return new StreamVoice(new VoiceOutput(context, buses[bus], gain), url, { startAt, endAt });
	}

	/**
	 * @param {string} url
	 * @returns {Promise<BufferHandle>}
	 */
	async loadBuffer(url) {
		const { context } = this.#unlocked();
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Could not load ${url}: HTTP ${response.status}`);
		}
		const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
		return new DecodedBuffer(audioBuffer);
	}

	/** @param {VoiceOptions & { buffer: BufferHandle }} options */
	createBufferVoice({ buffer, bus, gain = 1, startAt = 0, endAt = null }) {
		const { context, buses } = this.#unlocked();
		if (!(buffer instanceof DecodedBuffer)) {
			throw new TypeError('createBufferVoice needs a buffer from loadBuffer');
		}
		return new BufferVoice(new VoiceOutput(context, buses[bus], gain), buffer.audioBuffer, { startAt, endAt });
	}

	#createContext() {
		const context = new AudioContext({ latencyHint: 'interactive' });
		const master = context.createGain();
		master.connect(context.destination);
		const music = context.createGain();
		const sfx = context.createGain();
		music.connect(master);
		sfx.connect(master);
		this.#buses = { master, music, sfx };
		for (const bus of /** @type {Bus[]} */ (['master', 'music', 'sfx'])) {
			this.#buses[bus].gain.value = this.#gains[bus];
		}
		context.addEventListener('statechange', () => this.#onStateChange(context));
		this.#context = context;
		return context;
	}

	/**
	 * Only reports a suspension of a context that was running, so the brief suspended state right after creation, before
	 * `resume()` completes, is not mistaken for an interruption. Safari reports some interruptions as "interrupted".
	 * @param {AudioContext} context
	 */
	#onStateChange(context) {
		if (context.state === 'running') {
			this.#wasRunning = true;
			if (this.#announcedSuspension) {
				this.#announcedSuspension = false;
				this.#notify('resumed');
			}
		} else if (this.#wasRunning && !this.#announcedSuspension && context.state !== 'closed') {
			this.#announcedSuspension = true;
			this.#notify('suspended');
		}
	}

	/** @param {'suspended' | 'resumed'} type */
	#notify(type) {
		for (const handler of this.#handlers[type]) {
			handler();
		}
	}

	#unlocked() {
		if (!this.#context || !this.#buses) {
			throw new Error('Audio is locked: unlock() must be called from a user gesture first');
		}
		return { context: this.#context, buses: this.#buses };
	}
}

/** @implements {BufferHandle} */
class DecodedBuffer {
	/** @param {AudioBuffer} audioBuffer */
	constructor(audioBuffer) {
		this.audioBuffer = audioBuffer;
		this.memoryBytes = audioBuffer.length * audioBuffer.numberOfChannels * 4;
	}
}

/** Shared event plumbing: handlers stop being called once the voice is stopped. */
class VoiceEvents {
	stopped = false;
	/** @type {{ loaded: (() => void)[], ended: (() => void)[], error: ((error: VoiceError) => void)[] }} */
	#handlers = { loaded: [], ended: [], error: [] };
	#ended = false;

	/**
	 * @param {'loaded' | 'ended'} type
	 * @param {() => void} handler
	 */
	on(type, handler) {
		this.#handlers[type].push(handler);
	}

	/** @param {(error: VoiceError) => void} handler */
	onError(handler) {
		this.#handlers.error.push(handler);
	}

	loaded() {
		this.#call(this.#handlers.loaded);
	}

	ended() {
		if (!this.#ended) {
			this.#ended = true;
			this.#call(this.#handlers.ended);
		}
	}

	/** @param {string} message */
	error(message) {
		this.#call(this.#handlers.error, { message });
	}

	/**
	 * @template {unknown[]} A
	 * @param {((...args: A) => void)[]} handlers
	 * @param {A} args
	 */
	#call(handlers, ...args) {
		if (this.stopped) {
			return;
		}
		for (const handler of handlers) {
			handler(...args);
		}
	}
}

/**
 * The two gain stages every voice plays through: its own volume, then the fades. Keeping them apart means a fade never
 * needs to know the volume, and a volume change never disturbs a fade in progress.
 */
class VoiceOutput {
	#context;
	#volume;
	#fade;
	/** @type {FadeRamp} */
	#ramp = FULL;

	/**
	 * @param {AudioContext} context
	 * @param {AudioNode} destination
	 * @param {number} gain
	 */
	constructor(context, destination, gain) {
		this.#context = context;
		this.#volume = context.createGain();
		this.#volume.gain.value = gain;
		this.#fade = context.createGain();
		this.#volume.connect(this.#fade).connect(destination);
	}

	get context() {
		return this.#context;
	}

	/** Where the voice's source connects. */
	get input() {
		return this.#volume;
	}

	/** @param {number} gain */
	setGain(gain) {
		this.#volume.gain.setTargetAtTime(gain, this.#context.currentTime, GAIN_SMOOTHING_SECONDS);
	}

	/**
	 * @param {number} target
	 * @param {number} seconds
	 */
	rampFade(target, seconds) {
		const { gain } = this.#fade;
		const now = this.#context.currentTime;
		this.#ramp = rampTo(this.#ramp, target, seconds, now);
		gain.cancelScheduledValues(now);
		gain.setValueAtTime(this.#ramp.from, now);
		if (seconds > 0) {
			gain.linearRampToValueAtTime(target, this.#ramp.end);
		}
	}

	disconnect() {
		this.#volume.disconnect();
		this.#fade.disconnect();
	}
}

/**
 * A track streamed by a media element, so only a few seconds of it are ever in memory.
 * @implements {Voice}
 */
class StreamVoice {
	#output;
	#element;
	#source;
	#startAt;
	#endAt;
	#events = new VoiceEvents();
	#listeners = new AbortController();
	/** @type {number | null} */
	#endTimer = null;

	/**
	 * @param {VoiceOutput} output
	 * @param {string} url
	 * @param {Clip} clip
	 */
	constructor(output, url, { startAt, endAt }) {
		this.#output = output;
		this.#startAt = startAt;
		this.#endAt = endAt;
		this.#element = new Audio();
		this.#element.preload = 'auto';
		this.#source = output.context.createMediaElementSource(this.#element);
		this.#source.connect(output.input);

		const { signal } = this.#listeners;
		this.#element.addEventListener('loadedmetadata', () => {
			// Playback can't begin before the metadata is in, so seeking here means no audio before the start point.
			if (startAt > 0) {
				this.#element.currentTime = startAt;
			}
			this.#events.loaded();
		}, { signal });
		this.#element.addEventListener('ended', () => this.#events.ended(), { signal });
		this.#element.addEventListener('error', () => this.#events.error(describeMediaError(this.#element.error)), { signal });
		if (endAt !== null) {
			this.#element.addEventListener('playing', () => this.#planEnd(), { signal });
			this.#element.addEventListener('seeked', () => this.#planEnd(), { signal });
			this.#element.addEventListener('pause', () => this.#cancelEnd(), { signal });
		}
		this.#element.src = url;
	}

	get position() {
		return this.#element.currentTime;
	}

	get duration() {
		const { duration } = this.#element;
		return Number.isFinite(duration) ? duration : Number.NaN;
	}

	play() {
		if (this.#events.stopped) {
			return;
		}
		this.#element.play().catch((/** @type {unknown} */ error) => {
			// AbortError only means a pause() or stop() interrupted the start, which is expected.
			if (error instanceof Error && error.name !== 'AbortError') {
				this.#events.error(`${error.name}: ${error.message}`);
			}
		});
	}

	pause() {
		this.#element.pause();
	}

	/** @param {number} seconds */
	seek(seconds) {
		this.#element.currentTime = seconds;
	}

	/**
	 * @param {number} target
	 * @param {number} seconds
	 */
	rampGain(target, seconds) {
		this.#output.rampFade(target, seconds);
	}

	/** @param {number} gain */
	setGain(gain) {
		this.#output.setGain(gain);
	}

	/**
	 * The element loops by itself, without a gap, and doesn't fire `ended` while it does.
	 * @param {boolean} looping
	 */
	setLooping(looping) {
		this.#element.loop = looping;
	}

	/** @type {Voice['on']} */
	on(type, handler) {
		this.#events.on(type, handler);
	}

	/** @type {Voice['onError']} */
	onError(handler) {
		this.#events.onError(handler);
	}

	stop() {
		if (this.#events.stopped) {
			return;
		}
		this.#events.stopped = true;
		this.#cancelEnd();
		this.#listeners.abort();
		this.#element.pause();
		this.#source.disconnect();
		this.#output.disconnect();
		// Clearing the source and reloading is what makes the browser drop its buffers and close the connection.
		this.#element.removeAttribute('src');
		this.#element.load();
	}

	/**
	 * Media elements have no end point of their own, so a timer stops playback there. Timers can fire a little early or,
	 * in a background tab, late; an early one just waits again for the time still left.
	 */
	#planEnd() {
		this.#cancelEnd();
		const endAt = /** @type {number} */ (this.#endAt);
		if (this.#element.paused) {
			return;
		}
		const left = endAt - this.#element.currentTime;
		if (left <= END_TOLERANCE_SECONDS && this.#element.loop) {
			// The element's own looping covers the whole file, so a loop that ends earlier goes back by hand.
			this.#element.currentTime = this.#startAt;
			return;
		}
		if (left <= END_TOLERANCE_SECONDS) {
			this.#element.pause();
			this.#events.ended();
			return;
		}
		this.#endTimer = window.setTimeout(() => this.#planEnd(), (left / this.#element.playbackRate) * 1000);
	}

	#cancelEnd() {
		if (this.#endTimer !== null) {
			window.clearTimeout(this.#endTimer);
			this.#endTimer = null;
		}
	}
}

/**
 * A short sound played from a decoded buffer, which starts without any loading delay.
 * @implements {Voice}
 */
class BufferVoice {
	#output;
	#context;
	#buffer;
	#startAt;
	#endAt;
	#looping = false;
	#events = new VoiceEvents();
	/** @type {AudioBufferSourceNode | null} */
	#source = null;
	#offset;
	#startedAt = 0;

	/**
	 * @param {VoiceOutput} output
	 * @param {AudioBuffer} buffer
	 * @param {Clip} clip
	 */
	constructor(output, buffer, { startAt, endAt }) {
		this.#output = output;
		this.#context = output.context;
		this.#buffer = buffer;
		this.#startAt = Math.min(startAt, buffer.duration);
		this.#offset = this.#startAt;
		this.#endAt = endAt;
		// The duration is known right away; announce it asynchronously, like a media element would.
		queueMicrotask(() => this.#events.loaded());
	}

	get position() {
		if (!this.#source) {
			return this.#offset;
		}
		const played = this.#offset + this.#context.currentTime - this.#startedAt;
		const length = this.#end - this.#startAt;
		if (this.#looping && played > this.#end && length > 0) {
			return this.#startAt + ((played - this.#startAt) % length);
		}
		return Math.min(this.#end, played);
	}

	get duration() {
		return this.#buffer.duration;
	}

	/** Where playback stops: the end point, or the end of the buffer. */
	get #end() {
		return Math.min(this.duration, this.#endAt ?? Number.POSITIVE_INFINITY);
	}

	play() {
		if (this.#events.stopped || this.#source) {
			return;
		}
		const source = this.#context.createBufferSource();
		source.buffer = this.#buffer;
		source.connect(this.#output.input);
		source.addEventListener('ended', () => {
			if (this.#source === source) {
				this.#source = null;
				this.#offset = this.#end;
				this.#events.ended();
			}
		});
		if (this.#looping) {
			// A length would cap the whole playback, loops included, so a looping source gets loop points instead.
			source.loop = true;
			source.loopStart = this.#startAt;
			source.loopEnd = this.#end;
			source.start(0, this.#offset);
		} else {
			// Giving the length lets the audio thread stop at the end point to the sample.
			source.start(0, this.#offset, Math.max(0, this.#end - this.#offset));
		}
		this.#startedAt = this.#context.currentTime;
		this.#source = source;
	}

	/**
	 * A playing source can't change how it was started, so it is restarted from where it is.
	 * @param {boolean} looping
	 */
	setLooping(looping) {
		if (looping === this.#looping) {
			return;
		}
		const wasPlaying = this.#source !== null;
		const position = this.position;
		this.#halt();
		this.#looping = looping;
		this.#offset = position;
		if (wasPlaying) {
			this.play();
		}
	}

	pause() {
		if (this.#source) {
			this.#offset = this.position;
			this.#halt();
		}
	}

	/** @param {number} seconds */
	seek(seconds) {
		const wasPlaying = this.#source !== null;
		this.#halt();
		this.#offset = Math.min(Math.max(0, seconds), this.duration);
		if (wasPlaying) {
			this.play();
		}
	}

	/**
	 * @param {number} target
	 * @param {number} seconds
	 */
	rampGain(target, seconds) {
		this.#output.rampFade(target, seconds);
	}

	/** @param {number} gain */
	setGain(gain) {
		this.#output.setGain(gain);
	}

	/** @type {Voice['on']} */
	on(type, handler) {
		this.#events.on(type, handler);
	}

	/** @type {Voice['onError']} */
	onError(handler) {
		this.#events.onError(handler);
	}

	stop() {
		if (this.#events.stopped) {
			return;
		}
		this.#events.stopped = true;
		this.#halt();
		this.#output.disconnect();
	}

	/** Stops the current source node; clearing `#source` first means its `ended` event is ignored. */
	#halt() {
		const source = this.#source;
		this.#source = null;
		if (source) {
			source.stop();
			source.disconnect();
		}
	}
}

/** @param {MediaError | null} error */
function describeMediaError(error) {
	const reasons = ['', 'Playback was aborted', 'A network error stopped the download', 'The file could not be decoded', 'The file format is not supported'];
	return error ? (error.message || reasons[error.code] || `Media error ${error.code}`) : 'Unknown media error';
}
