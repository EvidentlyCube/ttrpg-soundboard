import { InvalidCommandError } from './errors.js';
import { createOrderStrategy } from './order-strategies.js';
import { planTrack, resolvePlaybackRules } from './playback-rules.js';
import { resolveTransition } from './transitions.js';

/** @typedef {import('./ports.js').AudioEngine} AudioEngine */
/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('./ports.js').Voice} Voice */
/** @typedef {import('./playback-rules.js').PlaybackRules} PlaybackRules */
/** @typedef {import('./transitions.js').Transition} Transition */
/** @typedef {import('./transitions.js').TransitionTiming} TransitionTiming */

/** @typedef {'idle' | 'loading' | 'playing' | 'paused'} PlaylistState */

/**
 * @typedef {{ type: 'playlist.stateChanged', playlistId: string, state: PlaylistState, trackIndex: number | null,
 * 	track: AudioFileJson | null, duration: number | null }} PlaylistStateChangedEvent
 * @typedef {{ type: 'playlist.progress', playlistId: string, position: number, duration: number | null }} PlaylistProgressEvent
 * @typedef {{ type: 'playlist.error', playlistId: string, trackId: string, message: string }} PlaylistErrorEvent
 * @typedef {PlaylistStateChangedEvent | PlaylistProgressEvent | PlaylistErrorEvent} PlaylistEvent
 */

/**
 * @typedef {object} PlaylistSnapshot
 * @property {string} playlistId
 * @property {PlaylistState} state
 * @property {number | null} trackIndex
 * @property {AudioFileJson | null} track
 * @property {number} position
 * @property {number | null} duration
 */

/**
 * @typedef {object} CurrentVoice
 * @property {Voice} voice
 * @property {number} trackIndex
 * @property {number} generation
 * @property {boolean} loaded
 * @property {number | null} pendingSeek applied once the track has loaded
 */

/** @typedef {{ voice: Voice, trackIndex: number, timer: number }} RetiringVoice */

const PROGRESS_INTERVAL_MS = 250;
const RESTART_THRESHOLD_SECONDS = 3;
const MAX_RETIRING_VOICES = 4;
const RETIRING_GRACE_MS = 1000;

/**
 * Plays one playlist (DESIGN.md §8). Every command is synchronous, and every voice callback is tied to the generation
 * it was created in, so callbacks from replaced or stopped voices can never change what is playing.
 */
export class PlaylistPlayer {
	#playlist;
	#engine;
	#clock;
	#emit;
	#rules;
	#order;
	#isPlayable;
	/** The playlist's own volume; each voice plays at this times its track's gain (DESIGN.md §6.4). */
	#gain;
	/** @type {PlaylistState} */
	#state = 'idle';
	#generation = 0;
	/** @type {CurrentVoice | null} */
	#current = null;
	/** @type {RetiringVoice[]} */
	#retiring = [];
	#consecutiveErrors = 0;
	/** @type {number | null} */
	#progressTimer = null;

	/**
	 * @param {object} options
	 * @param {PlaylistJson} options.playlist
	 * @param {Pick<AudioEngine, 'createStreamVoice'>} options.engine
	 * @param {Clock} options.clock
	 * @param {(event: PlaylistEvent) => void} options.emit
	 * @param {Readonly<PlaybackRules>} [options.rules]
	 * @param {(track: AudioFileJson) => boolean} [options.isPlayable]
	 */
	constructor({ playlist, engine, clock, emit, rules = resolvePlaybackRules(playlist), isPlayable = () => true }) {
		this.#playlist = playlist;
		this.#engine = engine;
		this.#clock = clock;
		this.#emit = emit;
		this.#rules = rules;
		this.#isPlayable = isPlayable;
		this.#gain = playlist.gain;
		this.#order = createOrderStrategy(rules.order, playlist.tracks.length, { loop: rules.loop });
	}

	get id() {
		return this.#playlist.id;
	}

	get state() {
		return this.#state;
	}

	/** @returns {PlaylistSnapshot} */
	snapshot() {
		const current = this.#current;
		return {
			playlistId: this.#playlist.id,
			state: this.#state,
			trackIndex: current?.trackIndex ?? null,
			track: current ? this.#playlist.tracks[current.trackIndex] : null,
			position: current?.voice.position ?? 0,
			duration: current ? knownOrNull(current.voice.duration) : null,
		};
	}

	/** @param {Transition} [transition] */
	play(transition = 'default') {
		if (this.#state !== 'idle') {
			return;
		}
		const first = this.#order.first();
		if (first === null) {
			return;
		}
		this.#consecutiveErrors = 0;
		this.#startTrack(first, resolveTransition('play', transition, this.#rules));
	}

	/** @param {Transition} [transition] */
	stop(transition = 'default') {
		if (this.#state === 'idle') {
			return;
		}
		this.#generation++;
		this.#retireCurrent(resolveTransition('stop', transition, this.#rules));
		this.#stopProgress();
		this.#setState('idle');
	}

	/** @param {Transition} [transition] */
	next(transition = 'default') {
		const current = this.#current;
		if (!current) {
			return;
		}
		const index = this.#order.next(current.trackIndex);
		if (index === null) {
			this.stop(transition);
			return;
		}
		this.#startTrack(index, resolveTransition('change', transition, this.#rules));
	}

	/**
	 * Restarts the current track once it has played for a few seconds, like most players; otherwise goes back one track.
	 * @param {Transition} [transition]
	 */
	previous(transition = 'default') {
		const current = this.#current;
		if (!current) {
			return;
		}
		const index = current.voice.position > RESTART_THRESHOLD_SECONDS ? null : this.#order.previous(current.trackIndex);
		if (index === null) {
			this.seek(0);
			this.resume();
			return;
		}
		this.#startTrack(index, resolveTransition('change', transition, this.#rules));
	}

	/**
	 * @param {number} trackIndex
	 * @param {Transition} [transition]
	 */
	jumpTo(trackIndex, transition = 'default') {
		if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= this.#playlist.tracks.length) {
			throw new InvalidCommandError(`Playlist "${this.#playlist.id}" has no track ${trackIndex}`);
		}
		const action = this.#state === 'idle' ? 'play' : 'change';
		this.#consecutiveErrors = 0;
		this.#startTrack(trackIndex, resolveTransition(action, transition, this.#rules));
	}

	/** @param {number} seconds */
	seek(seconds) {
		if (typeof seconds !== 'number' || Number.isNaN(seconds)) {
			throw new InvalidCommandError(`Seek position must be a number, got ${String(seconds)}`);
		}
		const current = this.#current;
		if (!current) {
			return;
		}
		if (current.loaded) {
			current.voice.seek(Math.min(Math.max(0, seconds), current.voice.duration));
		} else {
			current.pendingSeek = Math.max(0, seconds);
		}
		this.#emitProgress();
	}

	pause() {
		if (!this.#current || (this.#state !== 'playing' && this.#state !== 'loading')) {
			return;
		}
		this.#current.voice.pause();
		this.#stopProgress();
		this.#setState('paused');
	}

	resume() {
		const current = this.#current;
		if (!current || this.#state !== 'paused') {
			return;
		}
		current.voice.play();
		if (current.loaded) {
			this.#setState('playing');
			this.#startProgress();
		} else {
			this.#setState('loading');
		}
	}

	/**
	 * Changes the playlist's own volume for every voice it owns, including voices still fading out; their fades go on
	 * undisturbed, because fades use a separate gain stage (DESIGN.md §6.3).
	 * @param {number} gain linear multiplier
	 */
	setGain(gain) {
		this.#gain = gain;
		if (this.#current) {
			this.#current.voice.setGain(this.#voiceGain(this.#current.trackIndex));
		}
		for (const retiring of this.#retiring) {
			retiring.voice.setGain(this.#voiceGain(retiring.trackIndex));
		}
	}

	/**
	 * Replaces the rules, for example after the crossfade was customized. They apply from the next change of track.
	 * @param {Readonly<PlaybackRules>} rules
	 */
	setRules(rules) {
		this.#rules = rules;
	}

	/**
	 * @param {number} index
	 * @param {TransitionTiming} timing
	 */
	#startTrack(index, timing) {
		const generation = ++this.#generation;
		this.#retireCurrent(timing);
		this.#stopProgress();

		const track = this.#playlist.tracks[index];
		if (!this.#isPlayable(track)) {
			this.#failTrack(index, `This browser cannot play ${track.format} files`);
			return;
		}

		const voice = this.#engine.createStreamVoice({ url: track.url, bus: 'music', gain: this.#voiceGain(index) });
		const { startAt } = planTrack(track, this.#rules);
		/** @type {CurrentVoice} */
		const current = { voice, trackIndex: index, generation, loaded: false, pendingSeek: startAt > 0 ? startAt : null };
		this.#current = current;
		voice.on('loaded', () => this.#onLoaded(current));
		voice.on('ended', () => this.#onEnded(current));
		voice.onError((error) => this.#onError(current, error.message));
		if (timing.fadeInSeconds > 0) {
			voice.rampGain(0, 0);
			voice.rampGain(1, timing.fadeInSeconds);
		}
		// Called right away rather than after loading, so a user-triggered start stays inside the click that caused it.
		voice.play();
		this.#setState('loading');
	}

	/** @param {CurrentVoice} current */
	#onLoaded(current) {
		if (!this.#isCurrent(current)) {
			return;
		}
		current.loaded = true;
		this.#consecutiveErrors = 0;
		if (current.pendingSeek !== null) {
			current.voice.seek(Math.min(current.pendingSeek, current.voice.duration));
			current.pendingSeek = null;
		}
		if (this.#state === 'loading') {
			this.#setState('playing');
			this.#startProgress();
		} else {
			this.#emitState();
		}
	}

	/** @param {CurrentVoice} current */
	#onEnded(current) {
		if (this.#isCurrent(current)) {
			this.#advanceFrom(current.trackIndex);
		}
	}

	/**
	 * @param {CurrentVoice} current
	 * @param {string} message
	 */
	#onError(current, message) {
		if (this.#isCurrent(current)) {
			this.#failTrack(current.trackIndex, message);
		}
	}

	/**
	 * @param {number} index
	 * @param {string} message
	 */
	#failTrack(index, message) {
		this.#emit({ type: 'playlist.error', playlistId: this.#playlist.id, trackId: this.#playlist.tracks[index].id, message });
		this.#consecutiveErrors++;
		if (this.#consecutiveErrors >= this.#playlist.tracks.length) {
			this.stop('instant');
			return;
		}
		this.#advanceFrom(index);
	}

	/**
	 * Moves on after the current track ended or failed. That voice has nothing left to play, so it is stopped
	 * outright rather than faded.
	 * @param {number} index
	 */
	#advanceFrom(index) {
		const next = this.#order.next(index);
		if (next === null) {
			this.stop('instant');
			return;
		}
		this.#startTrack(next, { ...resolveTransition('change', 'default', this.#rules), fadeOutSeconds: 0 });
	}

	/** @param {TransitionTiming} timing */
	#retireCurrent(timing) {
		const current = this.#current;
		this.#current = null;
		if (timing.killRetiring) {
			for (const retiring of [...this.#retiring]) {
				this.#finishRetiring(retiring);
			}
		}
		if (!current) {
			return;
		}
		if (timing.fadeOutSeconds <= 0 || this.#state !== 'playing') {
			current.voice.stop();
			return;
		}

		current.voice.rampGain(0, timing.fadeOutSeconds);
		/** @type {RetiringVoice} */
		const retiring = { voice: current.voice, trackIndex: current.trackIndex, timer: 0 };
		// The deadline, not the fade, is what guarantees the voice is released, even if the engine never reports anything.
		retiring.timer = this.#clock.setTimeout(() => this.#finishRetiring(retiring), timing.fadeOutSeconds * 1000 + RETIRING_GRACE_MS);
		this.#retiring.push(retiring);
		while (this.#retiring.length > MAX_RETIRING_VOICES) {
			this.#finishRetiring(this.#retiring[0]);
		}
	}

	/** @param {RetiringVoice} retiring */
	#finishRetiring(retiring) {
		this.#clock.clearTimeout(retiring.timer);
		retiring.voice.stop();
		this.#retiring = this.#retiring.filter((entry) => entry !== retiring);
	}

	/** @param {number} trackIndex */
	#voiceGain(trackIndex) {
		return this.#gain * this.#playlist.tracks[trackIndex].gain;
	}

	/** @param {CurrentVoice} current */
	#isCurrent(current) {
		return current === this.#current && current.generation === this.#generation;
	}

	#startProgress() {
		this.#stopProgress();
		this.#progressTimer = this.#clock.setInterval(() => this.#emitProgress(), PROGRESS_INTERVAL_MS);
	}

	#stopProgress() {
		if (this.#progressTimer !== null) {
			this.#clock.clearInterval(this.#progressTimer);
			this.#progressTimer = null;
		}
	}

	#emitProgress() {
		const current = this.#current;
		if (current) {
			this.#emit({
				type: 'playlist.progress',
				playlistId: this.#playlist.id,
				position: current.voice.position,
				duration: knownOrNull(current.voice.duration),
			});
		}
	}

	/** @param {PlaylistState} state */
	#setState(state) {
		this.#state = state;
		this.#emitState();
	}

	#emitState() {
		const { playlistId, state, trackIndex, track, duration } = this.snapshot();
		this.#emit({ type: 'playlist.stateChanged', playlistId, state, trackIndex, track, duration });
	}
}

/**
 * NaN is not valid JSON, and events must survive serialization.
 * @param {number} value
 */
function knownOrNull(value) {
	return Number.isNaN(value) ? null : value;
}
