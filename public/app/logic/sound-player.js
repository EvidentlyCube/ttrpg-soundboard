/** @typedef {import('./ports.js').AudioEngine} AudioEngine */
/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').Voice} Voice */
/** @typedef {import('./buffer-cache.js').BufferCache} BufferCache */

/**
 * @typedef {{ type: 'sound.activeChanged', soundId: string, active: boolean }} SoundActiveChangedEvent
 * @typedef {{ type: 'sound.error', soundId: string, message: string }} SoundErrorEvent
 * @typedef {SoundActiveChangedEvent | SoundErrorEvent} SoundEvent
 */

/** @typedef {{ sound: AudioFileJson, voice: Voice, streamed: boolean }} Instance */

const MAX_INSTANCES_PER_SOUND = 8;
const MAX_STREAMED_INSTANCES = 24;
const BUFFERED_SIZE_LIMIT = 256 * 1024;

/**
 * Plays sound effects (DESIGN.md §7). Every press starts a new, overlapping instance. Small files play from decoded
 * buffers for an instant start; large ones stream.
 */
export class SoundPlayer {
	#engine;
	#cache;
	#emit;
	#isPlayable;
	/** @type {Map<string, Instance[]>} */
	#instances = new Map();
	/** Streamed instances across all sounds, oldest first. @type {Instance[]} */
	#streamed = [];
	/** Incremented by `stop`, so starts still waiting for a decode can tell they were cancelled. @type {Map<string, number>} */
	#epochs = new Map();
	/** Gains changed since the library was loaded; they win over the gain in a sound object. @type {Map<string, number>} */
	#gains = new Map();

	/**
	 * @param {object} options
	 * @param {Pick<AudioEngine, 'createStreamVoice' | 'createBufferVoice'>} options.engine
	 * @param {BufferCache} options.cache
	 * @param {(event: SoundEvent) => void} options.emit
	 * @param {(sound: AudioFileJson) => boolean} [options.isPlayable]
	 */
	constructor({ engine, cache, emit, isPlayable = () => true }) {
		this.#engine = engine;
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
		if (sound.size > BUFFERED_SIZE_LIMIT) {
			this.#start(sound, this.#engine.createStreamVoice({ url: sound.url, bus: 'sfx', gain: this.#gainOf(sound) }), true);
			return;
		}
		const epoch = this.#epochOf(sound.id);
		this.#cache.get(sound.url).then(
			(buffer) => {
				if (this.#epochOf(sound.id) === epoch) {
					this.#start(sound, this.#engine.createBufferVoice({ buffer, bus: 'sfx', gain: this.#gainOf(sound) }), false);
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
		const instance = { sound, voice, streamed };
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
		instance.voice.stop();
		if (remaining.length === 0) {
			this.#emit({ type: 'sound.activeChanged', soundId: sound.id, active: false });
		}
	}

	/** @param {string} soundId */
	#epochOf(soundId) {
		return this.#epochs.get(soundId) ?? 0;
	}
}

/** @param {unknown} error */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
