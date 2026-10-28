import { FULL, levelAt, rampTo } from './fade-ramp.js';

/** @typedef {import('./ports.js').AudioEngine} AudioEngine */
/** @typedef {import('./ports.js').Bus} Bus */
/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').Voice} Voice */
/** @typedef {import('./ports.js').VoiceOptions} VoiceOptions */
/** @typedef {import('./fade-ramp.js').FadeRamp} FadeRamp */

/** @typedef {'loading' | 'playing' | 'paused' | 'fading in' | 'fading out' | 'ended' | 'stopped' | 'error'} VoiceStatus */

/**
 * What the debug view shows about one voice (DESIGN.md §6.5). `volume` is the voice's own level: its gain times its
 * fade, without the bus and master volumes.
 * @typedef {object} VoiceInfo
 * @property {number} serial 1 for the first voice ever made, then counting up; the order they were started in
 * @property {string} label
 * @property {Bus} bus
 * @property {VoiceStatus} status
 * @property {number} volume linear
 * @property {boolean} finished the voice ended, was stopped or failed; its last state is kept for a while
 * @property {string | null} message why it failed
 */

/**
 * @typedef {object} Entry
 * @property {number} serial
 * @property {string} label
 * @property {Bus} bus
 * @property {number} gain
 * @property {FadeRamp} ramp
 * @property {boolean} loaded
 * @property {boolean} wantsPlay `play()` was called more recently than `pause()`
 * @property {{ status: VoiceStatus, volume: number, message: string | null } | null} final how the voice finished
 * @property {number} timer removes a finished voice
 */

/** How long a finished voice stays listed. */
export const LINGER_MS = 5000;
/** Beyond this many entries the oldest finished ones are dropped early. */
export const MAX_ENTRIES = 200;

/**
 * Sits between the players and the real audio engine and records every voice that passes through it, for the debug
 * view (DESIGN.md §6.5). It is an `AudioEngine` itself and forwards everything, so neither the players nor the real
 * engine know it is there. Finished voices stay in its list for `LINGER_MS`; the voices themselves are released as
 * usual.
 * @implements {AudioEngine}
 */
export class VoiceMonitor {
	#engine;
	#clock;
	#onChange;
	#maxEntries;
	#nextSerial = 1;
	/** @type {Entry[]} */
	#entries = [];

	/**
	 * @param {object} options
	 * @param {AudioEngine} options.engine
	 * @param {Clock} options.clock
	 * @param {() => void} options.onChange called when a voice appears, changes status or goes away
	 * @param {number} [options.maxEntries]
	 */
	constructor({ engine, clock, onChange, maxEntries = MAX_ENTRIES }) {
		this.#engine = engine;
		this.#clock = clock;
		this.#onChange = onChange;
		this.#maxEntries = maxEntries;
	}

	/**
	 * Every voice still listed, oldest first, as it is right now.
	 * @returns {VoiceInfo[]}
	 */
	voices() {
		const now = this.#seconds();
		return this.#entries.map((entry) => ({
			serial: entry.serial,
			label: entry.label,
			bus: entry.bus,
			status: this.#statusOf(entry, now),
			volume: entry.final?.volume ?? this.#volumeOf(entry, now),
			finished: entry.final !== null,
			message: entry.final?.message ?? null,
		}));
	}

	unlock() {
		this.#engine.unlock();
	}

	/** @type {AudioEngine['on']} */
	on(type, handler) {
		this.#engine.on(type, handler);
	}

	/** @type {AudioEngine['canPlay']} */
	canPlay(format) {
		return this.#engine.canPlay(format);
	}

	/** @type {AudioEngine['setBusGain']} */
	setBusGain(bus, gain) {
		this.#engine.setBusGain(bus, gain);
	}

	/** @type {AudioEngine['loadBuffer']} */
	loadBuffer(url) {
		return this.#engine.loadBuffer(url);
	}

	/** @type {AudioEngine['createStreamVoice']} */
	createStreamVoice(options) {
		return this.#track(this.#engine.createStreamVoice(options), options);
	}

	/** @type {AudioEngine['createBufferVoice']} */
	createBufferVoice(options) {
		return this.#track(this.#engine.createBufferVoice(options), options);
	}

	/**
	 * @param {Voice} voice
	 * @param {VoiceOptions} options
	 */
	#track(voice, options) {
		/** @type {Entry} */
		const entry = {
			serial: this.#nextSerial++,
			label: options.label ?? '',
			bus: options.bus,
			gain: options.gain ?? 1,
			ramp: FULL,
			loaded: false,
			wantsPlay: false,
			final: null,
			timer: 0,
		};
		this.#entries.push(entry);
		this.#dropSurplus();
		voice.on('loaded', () => this.#change(entry, () => {
			entry.loaded = true;
		}));
		voice.on('ended', () => this.#finish(entry, 'ended', null));
		voice.onError(({ message }) => this.#finish(entry, 'error', message));
		this.#onChange();
		return new MonitoredVoice(voice, {
			play: () => this.#change(entry, () => {
				entry.wantsPlay = true;
			}),
			pause: () => this.#change(entry, () => {
				entry.wantsPlay = false;
			}),
			stop: () => this.#finish(entry, 'stopped', null),
			setGain: (gain) => {
				entry.gain = gain;
			},
			rampGain: (target, seconds) => this.#change(entry, () => {
				entry.ramp = rampTo(entry.ramp, target, seconds, this.#seconds());
			}),
		});
	}

	/**
	 * Applies a change and announces it if the status shown for the voice is now another.
	 * @param {Entry} entry
	 * @param {() => void} apply
	 */
	#change(entry, apply) {
		const before = this.#statusOf(entry, this.#seconds());
		apply();
		if (this.#statusOf(entry, this.#seconds()) !== before) {
			this.#onChange();
		}
	}

	/**
	 * The first way a voice finishes is the one kept: a player stops a voice that has ended, to release it.
	 * @param {Entry} entry
	 * @param {'ended' | 'stopped' | 'error'} status
	 * @param {string | null} message
	 */
	#finish(entry, status, message) {
		if (entry.final) {
			return;
		}
		entry.final = { status, volume: this.#volumeOf(entry, this.#seconds()), message };
		entry.timer = this.#clock.setTimeout(() => {
			this.#entries = this.#entries.filter((other) => other !== entry);
			this.#onChange();
		}, LINGER_MS);
		this.#onChange();
	}

	#dropSurplus() {
		while (this.#entries.length > this.#maxEntries) {
			const oldestFinished = this.#entries.find((entry) => entry.final);
			if (!oldestFinished) {
				return;
			}
			this.#clock.clearTimeout(oldestFinished.timer);
			this.#entries = this.#entries.filter((entry) => entry !== oldestFinished);
		}
	}

	/**
	 * @param {Entry} entry
	 * @param {number} now seconds
	 * @returns {VoiceStatus}
	 */
	#statusOf(entry, now) {
		if (entry.final) {
			return entry.final.status;
		}
		if (!entry.loaded) {
			return 'loading';
		}
		if (!entry.wantsPlay) {
			return 'paused';
		}
		if (now < entry.ramp.end && entry.ramp.to !== entry.ramp.from) {
			return entry.ramp.to > entry.ramp.from ? 'fading in' : 'fading out';
		}
		return 'playing';
	}

	/**
	 * @param {Entry} entry
	 * @param {number} now seconds
	 */
	#volumeOf(entry, now) {
		return entry.gain * levelAt(entry.ramp, now);
	}

	#seconds() {
		return this.#clock.now() / 1000;
	}
}

/**
 * The voice the players get: it passes everything to the real one and tells the monitor what happened.
 * @implements {Voice}
 */
class MonitoredVoice {
	#voice;
	#record;

	/**
	 * @param {Voice} voice
	 * @param {Pick<Voice, 'play' | 'pause' | 'stop' | 'setGain' | 'rampGain'>} record
	 */
	constructor(voice, record) {
		this.#voice = voice;
		this.#record = record;
	}

	get position() {
		return this.#voice.position;
	}

	get duration() {
		return this.#voice.duration;
	}

	play() {
		this.#record.play();
		this.#voice.play();
	}

	pause() {
		this.#record.pause();
		this.#voice.pause();
	}

	stop() {
		this.#voice.stop();
		this.#record.stop();
	}

	/** @param {number} seconds */
	seek(seconds) {
		this.#voice.seek(seconds);
	}

	/**
	 * @param {number} target
	 * @param {number} seconds
	 */
	rampGain(target, seconds) {
		this.#record.rampGain(target, seconds);
		this.#voice.rampGain(target, seconds);
	}

	/** @param {number} gain */
	setGain(gain) {
		this.#record.setGain(gain);
		this.#voice.setGain(gain);
	}

	/** @param {boolean} looping */
	setLooping(looping) {
		this.#voice.setLooping(looping);
	}

	/** @type {Voice['on']} */
	on(type, handler) {
		this.#voice.on(type, handler);
	}

	/** @type {Voice['onError']} */
	onError(handler) {
		this.#voice.onError(handler);
	}
}
