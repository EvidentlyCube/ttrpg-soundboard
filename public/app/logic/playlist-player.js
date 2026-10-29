import { InvalidCommandError } from './errors.js';
import { PlayHistory } from './play-history.js';
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
 * 	track: AudioFileJson | null, duration: number | null, crossfadeFrom: number | null,
 * 	resume: ResumePoint | null }} PlaylistStateChangedEvent
 * @typedef {{ type: 'playlist.progress', playlistId: string, position: number, duration: number | null,
 * 	crossfadeFrom: number | null }} PlaylistProgressEvent
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
 * @property {number | null} crossfadeFrom the position where the crossfade into the next track will start, if it will
 * @property {ResumePoint | null} resume where a stopped playlist will start again, if it remembers that
 */

/**
 * What a stopped playlist remembers (DESIGN.md §8.1). `position` is null when the track starts over.
 * @typedef {{ trackIndex: number, track: AudioFileJson, position: number | null }} ResumePoint
 */

/**
 * @typedef {object} CurrentVoice
 * @property {Voice} voice
 * @property {number} trackIndex
 * @property {number} generation
 * @property {boolean} loaded
 * @property {number} start where the track starts in its file, fixed when it started (DESIGN.md §8.2)
 * @property {number | null} endAt where it ends in its file, or null for the end of the file; fixed with `start`
 * @property {number | null} pendingSeek applied once the track has loaded, in seconds from the start point
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
	/** The tracks played and to play, with the current one (DESIGN.md §8.1). */
	#history;
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
	/** Fires when the current track should start crossfading into the next one. @type {number | null} */
	#crossfadeTimer = null;
	/**
	 * Where the next start picks up, kept by a stop according to the stop mode; the history is kept with it.
	 * @type {{ trackIndex: number, position: number | null } | null}
	 */
	#resumePoint = null;

	/**
	 * @param {object} options
	 * @param {PlaylistJson} options.playlist
	 * @param {Pick<AudioEngine, 'createStreamVoice'>} options.engine
	 * @param {Clock} options.clock
	 * @param {(event: PlaylistEvent) => void} options.emit
	 * @param {Readonly<PlaybackRules>} [options.rules]
	 * @param {(track: AudioFileJson) => boolean} [options.isPlayable]
	 * @param {() => number} [options.random] for the random orders; tests pass a seeded generator
	 */
	constructor({ playlist, engine, clock, emit, rules = resolvePlaybackRules(playlist), isPlayable = () => true, random = Math.random }) {
		this.#playlist = playlist;
		this.#engine = engine;
		this.#clock = clock;
		this.#emit = emit;
		this.#rules = rules;
		this.#isPlayable = isPlayable;
		this.#gain = playlist.gain;
		this.#history = new PlayHistory({ trackCount: playlist.tracks.length, order: rules.order, random, loop: rules.playlistLooping });
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
			position: current ? this.#position(current) : 0,
			duration: current ? knownOrNull(this.#length(current)) : null,
			crossfadeFrom: current ? this.#crossfadePoint(current) : null,
			resume: this.#resumePoint ? { ...this.#resumePoint, track: this.#playlist.tracks[this.#resumePoint.trackIndex] } : null,
		};
	}

	/**
	 * Starts the playlist, or picks it up where a stop left it when the stop mode remembered that.
	 * @param {Transition} [transition]
	 */
	play(transition = 'default') {
		if (this.#state !== 'idle') {
			return;
		}
		const resumePoint = this.#resumePoint;
		this.#resumePoint = null;
		const first = resumePoint?.trackIndex ?? this.#history.start();
		if (first === null) {
			return;
		}
		this.#consecutiveErrors = 0;
		this.#startTrack(first, resolveTransition('play', transition, this.#rules), resumePoint?.position ?? null);
	}

	/**
	 * Stops the playlist; the stop mode decides what the next start picks up (DESIGN.md §8.1).
	 * @param {Transition} [transition]
	 */
	stop(transition = 'default') {
		this.#stop(transition, true);
	}

	/** Makes a stopped playlist forget where it would resume, so the next start is a fresh one. */
	forget() {
		if (this.#state === 'idle' && this.#resumePoint) {
			this.#resumePoint = null;
			this.#emitState();
		}
	}

	/**
	 * @param {Transition} transition
	 * @param {boolean} remember false when the playlist stops by itself, having nothing left to play
	 */
	#stop(transition, remember) {
		if (this.#state === 'idle') {
			return;
		}
		this.#generation++;
		const timing = resolveTransition('stop', transition, this.#rules);
		const current = this.#current;
		this.#resumePoint = remember && current ? this.#trimResumePoint({ trackIndex: current.trackIndex, position: this.#positionOf(current) }) : null;
		// A fade-out longer than what is left would be cut off by the end of the track anyway.
		this.#retireCurrent(current ? { ...timing, fadeOutSeconds: Math.min(timing.fadeOutSeconds, this.#timeLeft(current)) } : timing);
		this.#stopProgress();
		this.#cancelCrossfade();
		this.#setState('idle');
	}

	/** @param {Transition} [transition] */
	next(transition = 'default') {
		const current = this.#current;
		if (!current) {
			return;
		}
		const index = this.#history.next();
		if (index === null) {
			this.#stop(transition, false);
			return;
		}
		this.#startTrack(index, this.#changeTiming(transition, index));
	}

	/**
	 * Restarts the current track once it has played for a few seconds, like most players, and at the start of the
	 * history; otherwise goes back one track in the history.
	 * @param {Transition} [transition]
	 */
	previous(transition = 'default') {
		const current = this.#current;
		if (!current) {
			return;
		}
		const index = this.#position(current) > RESTART_THRESHOLD_SECONDS ? null : this.#history.previous();
		if (index === null) {
			this.seek(0);
			this.resume();
			return;
		}
		this.#startTrack(index, this.#changeTiming(transition, index));
	}

	/**
	 * @param {number} trackIndex
	 * @param {Transition} [transition]
	 */
	jumpTo(trackIndex, transition = 'default') {
		if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= this.#playlist.tracks.length) {
			throw new InvalidCommandError(`Playlist "${this.#playlist.id}" has no track ${trackIndex}`);
		}
		this.#consecutiveErrors = 0;
		// A chosen track starts a fresh history, as if playback had started there.
		this.#resumePoint = null;
		this.#history.start(trackIndex);
		this.#startTrack(trackIndex, this.#state === 'idle'
			? resolveTransition('play', transition, this.#rules)
			: this.#changeTiming(transition, trackIndex));
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
			current.voice.seek(this.#seekTarget(current, seconds));
		} else {
			current.pendingSeek = Math.max(0, seconds);
		}
		this.#emitProgress();
		this.#planCrossfade();
	}

	/**
	 * Pausing is immediate and means silence, so a track still fading out from a crossfade is stopped too. A fade-in in
	 * progress ends at full level, so resuming never has to know about fades.
	 */
	pause() {
		if (!this.#current || (this.#state !== 'playing' && this.#state !== 'loading')) {
			return;
		}
		this.#current.voice.pause();
		this.#current.voice.rampGain(1, 0);
		this.#stopProgress();
		this.#cancelCrossfade();
		this.#finishAllRetiring();
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
			this.#planCrossfade();
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
		this.#applyGains();
	}

	#applyGains() {
		if (this.#current) {
			this.#current.voice.setGain(this.#voiceGain(this.#current.trackIndex));
		}
		for (const retiring of this.#retiring) {
			retiring.voice.setGain(this.#voiceGain(retiring.trackIndex));
		}
	}

	/**
	 * Takes a changed copy of the playlist, with the same tracks in the same order (a renamed track, say), and announces
	 * the current track again so its new title shows.
	 *
	 * A changed track gain reaches the voices at once. Changed start or end points never reach a track that is playing. But a paused track and a remembered one go back
	 * to their new start: the paused playlist stops, and a resume point keeps its track without the position.
	 * @param {PlaylistJson} playlist
	 */
	setPlaylist(playlist) {
		const old = this.#playlist;
		const moved = (/** @type {number | null} */ index) => index !== null
			&& (playlist.tracks[index].startAt !== old.tracks[index].startAt || playlist.tracks[index].endAt !== old.tracks[index].endAt);
		this.#playlist = playlist;
		this.#applyGains();
		const pausedTrack = this.#state === 'paused' ? this.#current?.trackIndex ?? null : null;
		if (moved(pausedTrack)) {
			this.#stop('instant', true);
		}
		const resumePoint = this.#resumePoint;
		if (resumePoint && resumePoint.position !== null && moved(resumePoint.trackIndex)) {
			this.#resumePoint = { ...resumePoint, position: null };
			this.#emitState();
		} else if (this.#state !== 'idle') {
			this.#emitState();
		}
	}

	/**
	 * Takes a copy of the playlist with tracks added or removed (DESIGN.md §8.1). Tracks sort by path, so the ones that
	 * stay may move; whatever refers to them follows, and the current track keeps playing. A removed current track
	 * stops the playlist instantly, and a resume point on a removed track is forgotten.
	 * @param {PlaylistJson} playlist
	 */
	replaceTracks(playlist) {
		const oldIds = this.#playlist.tracks.map((track) => track.id);
		const newIndices = new Map(playlist.tracks.map((track, index) => [track.id, index]));
		const remap = (/** @type {number} */ index) => newIndices.get(oldIds[index]) ?? null;
		if (this.#current && remap(this.#current.trackIndex) === null) {
			this.#stop('instant', true);
		}
		for (const retiring of [...this.#retiring]) {
			if (remap(retiring.trackIndex) === null) {
				this.#finishRetiring(retiring);
			}
		}
		this.#playlist = playlist;
		if (this.#current) {
			this.#current.trackIndex = /** @type {number} */ (remap(this.#current.trackIndex));
		}
		for (const retiring of this.#retiring) {
			retiring.trackIndex = /** @type {number} */ (remap(retiring.trackIndex));
		}
		if (this.#resumePoint) {
			const trackIndex = remap(this.#resumePoint.trackIndex);
			this.#resumePoint = trackIndex === null ? null : { ...this.#resumePoint, trackIndex };
		}
		this.#history.setTracks(playlist.tracks.length, remap);
		this.#planCrossfade();
		if (this.#state !== 'idle' || this.#resumePoint) {
			this.#emitState();
		}
	}

	/**
	 * Replaces the rules, for example after the crossfade was customized. They apply from the next change of track,
	 * including the end of the track playing now.
	 * @param {Readonly<PlaybackRules>} rules
	 */
	setRules(rules) {
		if (rules.order !== this.#rules.order) {
			this.#history.setOrder(rules.order);
		}
		if (rules.playlistLooping !== this.#rules.playlistLooping) {
			this.#history.setLoop(rules.playlistLooping);
		}
		if (rules.trackLooping !== this.#rules.trackLooping) {
			// Only the current track; one fading out in a crossfade just finishes its fade.
			this.#current?.voice.setLooping(rules.trackLooping);
		}
		this.#rules = rules;
		if (this.#resumePoint) {
			// What a stopped playlist remembers follows the mode at once, so the tile always matches the dialog.
			const trimmed = this.#trimResumePoint(this.#resumePoint);
			if (trimmed?.position !== this.#resumePoint.position) {
				this.#resumePoint = trimmed;
				this.#emitState();
			}
		}
		this.#planCrossfade();
		// Progress events carry the crossfade point; send one now so the display follows even while paused.
		this.#emitProgress();
	}

	/**
	 * Keeps as much of a resume point as the stop mode allows; it never adds back what was dropped.
	 * @param {{ trackIndex: number, position: number | null }} point
	 */
	#trimResumePoint(point) {
		switch (this.#rules.stopMode) {
			case 'pause':
				return point;
			case 'resetTrack':
				return { ...point, position: null };
			default:
				return null;
		}
	}

	/**
	 * Where the current track is, or is about to be once it has loaded.
	 * @param {CurrentVoice} current
	 */
	#positionOf(current) {
		return current.loaded ? this.#position(current) : current.pendingSeek ?? 0;
	}

	/**
	 * How far into the part that plays the voice is. Positions the facade reports and accepts count from the start point;
	 * only the voice itself works in file time (DESIGN.md §6.3).
	 * @param {CurrentVoice} current
	 */
	#position(current) {
		return Math.max(0, current.voice.position - current.start);
	}

	/**
	 * The length of the part that plays: NaN until the voice has loaded and knows the length of its file, which also
	 * caps an end point past the real end.
	 * @param {CurrentVoice} current
	 */
	#length(current) {
		return Math.max(0, Math.min(current.voice.duration, current.endAt ?? Infinity) - current.start);
	}

	/**
	 * The timing for moving from the current track to another (DESIGN.md §8.4). A crossfade lasts at most half of either
	 * track, and the fade-out never outlasts what is left of the current track.
	 * @param {Transition} transition
	 * @param {number} toIndex
	 * @returns {TransitionTiming}
	 */
	#changeTiming(transition, toIndex) {
		const timing = resolveTransition('change', transition, this.#rules);
		const current = this.#current;
		if (!current || timing.fadeInSeconds <= 0) {
			return timing;
		}
		const overlap = this.#overlap(current, toIndex);
		return { ...timing, fadeInSeconds: overlap, fadeOutSeconds: Math.min(overlap, this.#timeLeft(current)) };
	}

	/**
	 * @param {CurrentVoice} current
	 * @param {number} toIndex
	 */
	#overlap(current, toIndex) {
		const length = this.#length(current);
		const fromLength = Number.isFinite(length) ? length : this.#trackLength(current.trackIndex);
		return Math.min(this.#rules.crossfade, fromLength / 2, this.#trackLength(toIndex) / 2);
	}

	/**
	 * The length of the part of a track that plays, from its stored duration; infinite when that is unknown.
	 * @param {number} index
	 */
	#trackLength(index) {
		const track = this.#playlist.tracks[index];
		const { startAt, endAt } = planTrack(track, this.#rules);
		return track.duration === null ? Infinity : Math.max(0, Math.min(track.duration, endAt ?? Infinity) - startAt);
	}

	/**
	 * Where in the current track the crossfade into the next one will start, for display; null when there won't be one.
	 * @param {CurrentVoice} current
	 */
	#crossfadePoint(current) {
		const length = this.#length(current);
		// A looping track starts over seamlessly instead of crossfading into the next one.
		if (this.#rules.crossfade <= 0 || this.#rules.trackLooping || !Number.isFinite(length)) {
			return null;
		}
		const next = this.#history.upcoming();
		if (next === null) {
			return null;
		}
		return Math.max(0, length - this.#overlap(current, next));
	}

	/**
	 * Where a seek in a loaded track lands, as a position in the voice's file: within the part that plays, and never past
	 * the crossfade point, so seeking towards the end starts the whole crossfade instead of a squeezed one (DESIGN.md §8.4).
	 * @param {CurrentVoice} current
	 * @param {number} seconds from the start point
	 */
	#seekTarget(current, seconds) {
		const limit = this.#crossfadePoint(current) ?? this.#length(current);
		return current.start + Math.min(Math.max(0, seconds), limit);
	}

	/** @param {CurrentVoice} current */
	#timeLeft(current) {
		const length = this.#length(current);
		return Number.isFinite(length) ? Math.max(0, length - this.#position(current)) : Infinity;
	}

	/**
	 * Sets the timer that starts the crossfade into the next track before the current one ends, replacing any earlier
	 * one. From within the last seconds of the track it starts at once. If the timer never fires, `ended` still
	 * advances, without the overlap.
	 */
	#planCrossfade() {
		this.#cancelCrossfade();
		const current = this.#current;
		if (!current || !current.loaded || this.#state !== 'playing' || this.#rules.crossfade <= 0 || this.#rules.trackLooping) {
			return;
		}
		const next = this.#history.upcoming();
		const timeLeft = this.#timeLeft(current);
		if (next === null || !Number.isFinite(timeLeft)) {
			return;
		}
		const wait = timeLeft - this.#overlap(current, next);
		if (wait <= 0) {
			this.#crossfadeFrom(current);
			return;
		}
		this.#crossfadeTimer = this.#clock.setTimeout(() => {
			this.#crossfadeTimer = null;
			this.#crossfadeFrom(current);
		}, wait * 1000);
	}

	/** @param {CurrentVoice} current */
	#crossfadeFrom(current) {
		if (this.#isCurrent(current) && this.#state === 'playing' && this.#history.upcoming() !== null) {
			const next = /** @type {number} */ (this.#history.next());
			this.#startTrack(next, this.#changeTiming('default', next));
		}
	}

	#cancelCrossfade() {
		if (this.#crossfadeTimer !== null) {
			this.#clock.clearTimeout(this.#crossfadeTimer);
			this.#crossfadeTimer = null;
		}
	}

	/**
	 * @param {number} index
	 * @param {TransitionTiming} timing
	 * @param {number | null} [at] where to start instead of the track's start point, in seconds from it, when resuming
	 */
	#startTrack(index, timing, at = null) {
		const generation = ++this.#generation;
		this.#retireCurrent(timing);
		this.#stopProgress();
		this.#cancelCrossfade();

		const track = this.#playlist.tracks[index];
		if (!this.#isPlayable(track)) {
			this.#failTrack(index, `This browser cannot play ${track.format} files`);
			return;
		}

		// The range is fixed here, so editing the track's points never moves a track that is already playing.
		const { startAt, endAt } = planTrack(track, this.#rules);
		const voice = this.#engine.createStreamVoice({ url: track.url, bus: 'music', label: track.title, gain: this.#voiceGain(index), startAt, endAt });
		/** @type {CurrentVoice} */
		const current = { voice, trackIndex: index, generation, loaded: false, start: startAt, endAt, pendingSeek: at !== null && at > 0 ? at : null };
		this.#current = current;
		voice.on('loaded', () => this.#onLoaded(current));
		voice.on('ended', () => this.#onEnded(current));
		voice.onError((error) => this.#onError(current, error.message));
		voice.setLooping(this.#rules.trackLooping);
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
			current.voice.seek(this.#seekTarget(current, current.pendingSeek));
			current.pendingSeek = null;
		}
		if (this.#state === 'loading') {
			this.#setState('playing');
			this.#startProgress();
			this.#planCrossfade();
		} else {
			this.#emitState();
		}
	}

	/** @param {CurrentVoice} current */
	#onEnded(current) {
		if (this.#isCurrent(current)) {
			this.#advance();
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
			this.#stop('instant', false);
			return;
		}
		this.#advance();
	}

	/**
	 * Moves on after the current track ended or failed. That voice has nothing left to play, so it is stopped
	 * outright rather than faded.
	 */
	#advance() {
		const next = this.#history.next();
		if (next === null) {
			this.#stop('instant', false);
			return;
		}
		this.#startTrack(next, { ...this.#changeTiming('default', next), fadeOutSeconds: 0 });
	}

	/** @param {TransitionTiming} timing */
	#retireCurrent(timing) {
		const current = this.#current;
		this.#current = null;
		if (timing.killRetiring) {
			this.#finishAllRetiring();
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

	#finishAllRetiring() {
		for (const retiring of [...this.#retiring]) {
			this.#finishRetiring(retiring);
		}
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
				position: this.#position(current),
				duration: knownOrNull(this.#length(current)),
				crossfadeFrom: this.#crossfadePoint(current),
			});
		}
	}

	/** @param {PlaylistState} state */
	#setState(state) {
		this.#state = state;
		this.#emitState();
	}

	#emitState() {
		const { playlistId, state, trackIndex, track, duration, crossfadeFrom, resume } = this.snapshot();
		this.#emit({ type: 'playlist.stateChanged', playlistId, state, trackIndex, track, duration, crossfadeFrom, resume });
	}
}

/**
 * NaN is not valid JSON, and events must survive serialization.
 * @param {number} value
 */
function knownOrNull(value) {
	return Number.isNaN(value) ? null : value;
}
