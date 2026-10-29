/** @typedef {import('./ports.js').AudioEngine} AudioEngine */
/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').Voice} Voice */
/** @typedef {import('./buffer-cache.js').BufferCache} BufferCache */

/**
 * @typedef {{ type: 'sound.activeChanged', soundId: string, active: boolean }} SoundActiveChangedEvent
 * @typedef {{ type: 'sound.error', soundId: string, message: string }} SoundErrorEvent
 * @typedef {SoundActiveChangedEvent | SoundErrorEvent} SoundEvent
 */

/**
 * `fadeOutTimer` starts the fade-out so that it ends where playback does; after `fadeStop` it removes the instance
 * instead. `fading` is true from the moment the ramp to silence has started.
 * @typedef {{ sound: AudioFileJson, voice: Voice, streamed: boolean, fadeOutTimer: number | null, fading: boolean }} Instance
 */

const MAX_INSTANCES_PER_SOUND = 8;
const MAX_STREAMED_INSTANCES = 24;
const BUFFERED_SIZE_LIMIT = 256 * 1024;
/** After a stop's fade is over, an instance that is still there is removed anyway, as a playlist's retiring voices are. */
const FADE_GRACE_MS = 1000;

/**
 * Plays sound effects (DESIGN.md §7). Every press starts a new, overlapping instance. Small files play from decoded
 * buffers for an instant start; large ones stream.
 */
export class SoundPlayer {
	#engine;
	#clock;
	#cache;
	#emit;
	#isPlayable;
	/** @type {Map<string, Instance[]>} */
	#instances = new Map();
	/** Streamed instances across all sounds, oldest first. @type {Instance[]} */
	#streamed = [];
	/** Incremented by `stop`, so starts still waiting for a decode can tell they were cancelled. @type {Map<string, number>} */
	#epochs = new Map();
	/** Incremented by `stopAll` and `fadeStopAll`; it counts toward every sound's epoch. */
	#allEpoch = 0;
	/** Gains changed since the library was loaded; they win over the gain in a sound object. @type {Map<string, number>} */
	#gains = new Map();

	/**
	 * @param {object} options
	 * @param {Pick<AudioEngine, 'createStreamVoice' | 'createBufferVoice'>} options.engine
	 * @param {Pick<Clock, 'setTimeout' | 'clearTimeout'>} options.clock
	 * @param {BufferCache} options.cache
	 * @param {(event: SoundEvent) => void} options.emit
	 * @param {(sound: AudioFileJson) => boolean} [options.isPlayable]
	 */
	constructor({ engine, clock, cache, emit, isPlayable = () => true }) {
		this.#engine = engine;
		this.#clock = clock;
		this.#cache = cache;
		this.#emit = emit;
		this.#isPlayable = isPlayable;
	}

	/** @param {string} soundId */
	isActive(soundId) {
		return (this.#instances.get(soundId)?.length ?? 0) > 0;
	}

	/** @param {AudioFileJson} sound */
	play(sound) {
		if (!this.#isPlayable(sound)) {
			this.#emit({ type: 'sound.error', soundId: sound.id, message: `This browser cannot play ${sound.format} files` });
			return;
		}
		// Taken from the sound as it is now, so a later change of the points leaves this instance alone.
		const { startAt, endAt } = sound;
		if (sound.size > BUFFERED_SIZE_LIMIT) {
			this.#start(sound, this.#engine.createStreamVoice({ url: sound.url, bus: 'sfx', label: sound.title, gain: this.#gainOf(sound), startAt, endAt }), true);
			return;
		}
		const epoch = this.#epochOf(sound.id);
		this.#cache.get(sound.url).then(
			(buffer) => {
				if (this.#epochOf(sound.id) === epoch) {
					this.#start(sound, this.#engine.createBufferVoice({ buffer, bus: 'sfx', label: sound.title, gain: this.#gainOf(sound), startAt, endAt }), false);
				}
			},
			(error) => this.#emit({ type: 'sound.error', soundId: sound.id, message: messageOf(error) }),
		);
	}

	/**
	 * Stops every instance of the sound, including presses still waiting for their buffer.
	 * @param {string} soundId
	 */
	stop(soundId) {
		this.#epochs.set(soundId, this.#epochOf(soundId) + 1);
		for (const instance of [...(this.#instances.get(soundId) ?? [])]) {
			this.#remove(instance);
		}
	}

	/**
	 * Changes the sound's own volume, for the instances playing now and every later one.
	 * @param {string} soundId
	 * @param {number} gain linear multiplier
	 */
	setGain(soundId, gain) {
		this.#gains.set(soundId, gain);
		for (const instance of this.#instances.get(soundId) ?? []) {
			instance.voice.setGain(gain);
		}
	}

	/** @param {AudioFileJson} sound */
	#gainOf(sound) {
		return this.#gains.get(sound.id) ?? sound.gain;
	}

	/**
	 * @param {AudioFileJson} sound
	 * @param {Voice} voice
	 * @param {boolean} streamed
	 */
	#start(sound, voice, streamed) {
		const existing = this.#instances.get(sound.id) ?? [];
		if (existing.length >= MAX_INSTANCES_PER_SOUND) {
			this.#remove(existing[0]);
		}
		if (streamed && this.#streamed.length >= MAX_STREAMED_INSTANCES) {
			this.#remove(this.#streamed[0]);
		}

		const wasActive = this.isActive(sound.id);
		/** @type {Instance} */
		const instance = { sound, voice, streamed, fadeOutTimer: null, fading: false };
		this.#instances.set(sound.id, [...(this.#instances.get(sound.id) ?? []), instance]);
		if (streamed) {
			this.#streamed.push(instance);
		} else {
			this.#cache.retain(sound.url);
		}
		voice.on('ended', () => this.#remove(instance));
		voice.onError((error) => {
			this.#emit({ type: 'sound.error', soundId: sound.id, message: error.message });
			this.#remove(instance);
		});
		if (sound.fadeIn > 0) {
			voice.rampGain(0, 0);
			voice.rampGain(1, sound.fadeIn);
		}
		if (sound.fadeOut > 0) {
			voice.on('loaded', () => this.#planFadeOut(instance));
		}
		voice.play();
		if (!wasActive) {
			this.#emit({ type: 'sound.activeChanged', soundId: sound.id, active: true });
		}
	}

	/**
	 * Safe to call more than once for the same instance.
	 * @param {Instance} instance
	 */
	#remove(instance) {
		const { sound } = instance;
		const instances = this.#instances.get(sound.id) ?? [];
		if (!instances.includes(instance)) {
			return;
		}
		const remaining = instances.filter((entry) => entry !== instance);
		if (remaining.length > 0) {
			this.#instances.set(sound.id, remaining);
		} else {
			this.#instances.delete(sound.id);
		}
		if (instance.streamed) {
			this.#streamed = this.#streamed.filter((entry) => entry !== instance);
		} else {
			this.#cache.release(sound.url);
		}
		if (instance.fadeOutTimer !== null) {
			this.#clock.clearTimeout(instance.fadeOutTimer);
			instance.fadeOutTimer = null;
		}
		instance.voice.stop();
		if (remaining.length === 0) {
			this.#emit({ type: 'sound.activeChanged', soundId: sound.id, active: false });
		}
	}

	/**
	 * Plans the fade-out to end where playback ends: the end point, or the end of the file. It is cut to the time the
	 * sound has, and starts from wherever a fade-in had got to (DESIGN.md §6.3).
	 * @param {Instance} instance
	 */
	#planFadeOut(instance) {
		const { sound, voice } = instance;
		const end = Math.min(voice.duration, sound.endAt ?? Number.POSITIVE_INFINITY);
		if (!this.#instances.get(sound.id)?.includes(instance) || !Number.isFinite(end)) {
			return;
		}
		const left = Math.max(0, end - voice.position);
		const seconds = Math.min(sound.fadeOut, left);
		instance.fadeOutTimer = this.#clock.setTimeout(() => {
			instance.fadeOutTimer = null;
			instance.fading = true;
			voice.rampGain(0, seconds);
		}, (left - seconds) * 1000);
	}

	/**
	 * Ends every instance of every sound by fading it out over its sound's own `fadeOut` (an instance already fading
	 * out is left to finish), including presses still waiting for their buffer. Instances whose sound has no fade-out,
	 * or whose length is not known yet, stop at once.
	 */
	fadeStopAll() {
		this.#cancelPending();
		for (const instance of [...this.#instances.values()].flat()) {
			this.#fadeStop(instance);
		}
	}

	/** Stops every instance of every sound at once, including presses still waiting for their buffer. */
	stopAll() {
		this.#cancelPending();
		for (const instance of [...this.#instances.values()].flat()) {
			this.#remove(instance);
		}
	}

	/** @returns {{ fading: number, steady: number }} the live instances that are fading out and those that are not */
	count() {
		const instances = [...this.#instances.values()].flat();
		const fading = instances.filter((instance) => instance.fading).length;
		return { fading, steady: instances.length - fading };
	}

	/** @param {Instance} instance */
	#fadeStop(instance) {
		if (instance.fading) {
			return;
		}
		const { sound, voice } = instance;
		const end = Math.min(voice.duration, sound.endAt ?? Number.POSITIVE_INFINITY);
		const seconds = Number.isFinite(end) ? Math.min(sound.fadeOut, Math.max(0, end - voice.position)) : 0;
		if (seconds <= 0) {
			this.#remove(instance);
			return;
		}
		if (instance.fadeOutTimer !== null) {
			this.#clock.clearTimeout(instance.fadeOutTimer);
		}
		instance.fading = true;
		voice.rampGain(0, seconds);
		instance.fadeOutTimer = this.#clock.setTimeout(() => this.#remove(instance), seconds * 1000 + FADE_GRACE_MS);
	}

	/** Presses still waiting for a decode are dropped, whichever sound they belong to. */
	#cancelPending() {
		this.#allEpoch++;
	}

	/** @param {string} soundId */
	#epochOf(soundId) {
		return (this.#epochs.get(soundId) ?? 0) + this.#allEpoch;
	}
}

/** @param {unknown} error */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
