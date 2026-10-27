import { BufferCache } from './buffer-cache.js';
import { validateCommand } from './commands.js';
import { InvalidCommandError, NotReadyError } from './errors.js';
import { EventEmitter } from './event-emitter.js';
import { LibraryModel } from './library-model.js';
import { OptionsSync } from './options-sync.js';
import { resolvePlaybackRules } from './playback-rules.js';
import { PlaylistPlayer } from './playlist-player.js';
import { SettingsSync } from './settings-sync.js';
import { SoundPlayer } from './sound-player.js';
import { VolumeControl } from './volume.js';

/** @typedef {import('./ports.js').AudioEngine} AudioEngine */
/** @typedef {import('./ports.js').BackendApi} BackendApi */
/** @typedef {import('./ports.js').Bus} Bus */
/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').LibraryJson} LibraryJson */
/** @typedef {import('./ports.js').Logger} Logger */
/** @typedef {import('./ports.js').Volumes} Volumes */
/** @typedef {import('./ports.js').AudioFileJson} AudioFileJson */
/** @typedef {import('./ports.js').ItemOptions} ItemOptions */
/** @typedef {import('./ports.js').PlaylistJson} PlaylistJson */
/** @typedef {import('./commands.js').Command} Command */
/** @typedef {import('./playlist-player.js').PlaylistEvent} PlaylistEvent */
/** @typedef {import('./playlist-player.js').PlaylistSnapshot} PlaylistSnapshot */
/** @typedef {import('./sound-player.js').SoundEvent} SoundEvent */
/** @typedef {import('./transitions.js').Transition} Transition */
/** @typedef {import('./volume.js').VolumeChangedEvent} VolumeChangedEvent */

/**
 * @typedef {{ type: 'app.ready', library: LibraryJson, volumes: Volumes, unplayable: string[] }
 * 	| { type: 'app.startFailed', message: string }
 * 	| { type: 'audio.suspended' }
 * 	| { type: 'audio.resumed' }} AppEvent
 * @typedef {{ type: 'sound.changed', sound: AudioFileJson }
 * 	| { type: 'sound.saved', soundId: string }
 * 	| { type: 'sound.saveFailed', soundId: string, message: string }
 * 	| { type: 'playlist.changed', playlist: PlaylistJson }
 * 	| { type: 'playlist.saved', playlistId: string }
 * 	| { type: 'playlist.saveFailed', playlistId: string, message: string }
 * 	| { type: 'track.saved', trackId: string }
 * 	| { type: 'track.saveFailed', trackId: string, message: string }} CustomizeEvent
 * @typedef {AppEvent | SoundEvent | PlaylistEvent | VolumeChangedEvent | CustomizeEvent} SoundboardEvent
 */

/** @typedef {{ transition?: Transition }} TransitionOptions */
/** @typedef {import('./options-sync.js').ItemRef['kind']} ItemKind */

/**
 * The application API the UI talks to (DESIGN.md §6.1): commands in, events out. Every method is a thin wrapper that
 * builds a command and dispatches it, so a remote control can drive the same paths.
 */
export class Soundboard {
	#engine;
	#clock;
	#api;
	#logger;
	/** @type {EventEmitter<SoundboardEvent>} */
	#events;
	#volume;
	#settingsSync;
	#optionsSync;
	#random;
	/** @type {{ library: LibraryModel, sounds: SoundPlayer, playlists: Map<string, PlaylistPlayer> } | null} */
	#loaded = null;
	/** @type {Promise<void> | null} */
	#starting = null;
	/** Ids of non-idle playlists, in the order they started. @type {string[]} */
	#activeOrder = [];

	/**
	 * @param {object} ports
	 * @param {AudioEngine} ports.engine
	 * @param {Clock} ports.clock
	 * @param {BackendApi} ports.api
	 * @param {Logger} ports.logger
	 * @param {() => number} [ports.random] for the random playback orders; tests pass a seeded generator
	 */
	constructor({ engine, clock, api, logger, random = Math.random }) {
		this.#engine = engine;
		this.#clock = clock;
		this.#random = random;
		this.#api = api;
		this.#logger = logger;
		this.#events = new EventEmitter((error, event) => logger.error(`A handler for ${event.type} failed`, error));
		const emit = (/** @type {SoundboardEvent} */ event) => this.#events.emit(event);
		this.#volume = new VolumeControl({ setBusGain: (bus, gain) => engine.setBusGain(bus, gain), emit });
		this.#settingsSync = new SettingsSync({ saveVolumes: (volumes, options) => api.saveVolumes(volumes, options), clock, logger });
		/** @type {Record<ItemKind, (id: string, options: ItemOptions, request: { keepalive: boolean }) => Promise<void>>} */
		const savers = {
			sound: (id, options, request) => api.saveSoundOptions(id, options, request),
			playlist: (id, options, request) => api.savePlaylistOptions(id, options, request),
			track: (id, options, request) => api.saveTrackOptions(id, options, request),
		};
		/** @type {Record<ItemKind, (id: string) => CustomizeEvent>} */
		const savedEvents = {
			sound: (id) => ({ type: 'sound.saved', soundId: id }),
			playlist: (id) => ({ type: 'playlist.saved', playlistId: id }),
			track: (id) => ({ type: 'track.saved', trackId: id }),
		};
		/** @type {Record<ItemKind, (id: string, message: string) => CustomizeEvent>} */
		const failedEvents = {
			sound: (id, message) => ({ type: 'sound.saveFailed', soundId: id, message }),
			playlist: (id, message) => ({ type: 'playlist.saveFailed', playlistId: id, message }),
			track: (id, message) => ({ type: 'track.saveFailed', trackId: id, message }),
		};
		this.#optionsSync = new OptionsSync({
			save: ({ kind, id }, options, request) => savers[kind](id, options, request),
			clock,
			onSaved: ({ kind, id }) => emit(savedEvents[kind](id)),
			onFailed: ({ kind, id }, error) => {
				logger.warn(`Could not save the options of the ${kind} ${id}; they will be saved with the next change.`, error);
				emit(failedEvents[kind](id, error.message));
			},
		});
		engine.on('suspended', () => emit({ type: 'audio.suspended' }));
		engine.on('resumed', () => emit({ type: 'audio.resumed' }));
	}

	/**
	 * @template {SoundboardEvent['type']} T
	 * @param {T} type
	 * @param {(event: Extract<SoundboardEvent, { type: T }>) => void} handler
	 * @returns {() => void} unsubscribes
	 */
	on(type, handler) {
		return this.#events.on(type, handler);
	}

	/**
	 * @template {SoundboardEvent['type']} T
	 * @param {T} type
	 * @param {(event: Extract<SoundboardEvent, { type: T }>) => void} handler
	 */
	off(type, handler) {
		this.#events.off(type, handler);
	}

	/**
	 * Must be called from a click: unlocks audio synchronously, then loads the library once. Failures are reported
	 * through `app.startFailed`, after which `start` can be called again.
	 * @returns {Promise<void>}
	 */
	start() {
		this.#engine.unlock();
		if (this.#loaded) {
			return Promise.resolve();
		}
		this.#starting ??= this.#load();
		return this.#starting;
	}

	/** Call synchronously at the start of every click handler, in case the browser suspended audio since. */
	unlockAudio() {
		this.#engine.unlock();
	}

	/** Saves pending volume and option changes immediately; call it when the page is being hidden or closed. */
	flushSettings() {
		this.#settingsSync.flush();
		this.#optionsSync.flushAll();
	}

	/**
	 * Saves a sound's pending changes now instead of after the debounce, e.g. when its dialog closes.
	 * @param {string} soundId
	 */
	flushSoundOptions(soundId) {
		this.#optionsSync.flush({ kind: 'sound', id: soundId });
	}

	/**
	 * Saves a playlist's pending changes now instead of after the debounce, e.g. when its dialog closes.
	 * @param {string} playlistId
	 */
	flushPlaylistOptions(playlistId) {
		this.#optionsSync.flush({ kind: 'playlist', id: playlistId });
	}

	/**
	 * Saves a track's pending changes now instead of after the debounce, e.g. when its playlist's dialog closes.
	 * @param {string} trackId
	 */
	flushTrackOptions(trackId) {
		this.#optionsSync.flush({ kind: 'track', id: trackId });
	}

	/** @param {unknown} input a command, validated before it runs */
	dispatch(input) {
		const command = validateCommand(input);
		const loaded = this.#loaded;
		if (!loaded) {
			throw new NotReadyError();
		}
		switch (command.type) {
			case 'sound.play':
				loaded.sounds.play(loaded.library.sound(command.soundId));
				return;
			case 'sound.stop':
				loaded.sounds.stop(loaded.library.sound(command.soundId).id);
				return;
			case 'volume.set':
				this.#volume.setVolume(command.bus, command.value);
				this.#settingsSync.schedule(this.#volume.volumes);
				return;
			case 'track.customize': {
				const { playlist, track } = loaded.library.updateTrack(command.trackId, { title: command.title });
				loaded.playlists.get(playlist.id)?.setPlaylist(playlist);
				this.#optionsSync.schedule({ kind: 'track', id: track.id }, { title: track.title });
				this.#events.emit({ type: 'playlist.changed', playlist });
				return;
			}
			case 'sound.customize': {
				const { title, gain, startAt, endAt, fadeIn, fadeOut } = command;
				const sound = loaded.library.updateSound(command.soundId, { title, gain, startAt, endAt, fadeIn, fadeOut });
				if (gain !== undefined) {
					loaded.sounds.setGain(sound.id, sound.gain);
				}
				this.#optionsSync.schedule({ kind: 'sound', id: sound.id }, {
					title: sound.title,
					gain: sound.gain,
					startAt: sound.startAt,
					endAt: sound.endAt,
					fadeIn: sound.fadeIn,
					fadeOut: sound.fadeOut,
				});
				this.#events.emit({ type: 'sound.changed', sound });
				return;
			}
		}

		const player = this.#player(command.playlistId);
		switch (command.type) {
			case 'playlist.toggle':
				if (player.state === 'idle') {
					player.play();
				} else {
					player.stop();
				}
				return;
			case 'playlist.play':
				player.play(command.transition);
				return;
			case 'playlist.stop':
				player.stop(command.transition);
				return;
			case 'playlist.next':
				player.next(command.transition);
				return;
			case 'playlist.previous':
				player.previous(command.transition);
				return;
			case 'playlist.jump':
				player.jumpTo(command.trackIndex, command.transition);
				return;
			case 'playlist.seek':
				player.seek(command.seconds);
				return;
			case 'playlist.pause':
				player.pause();
				return;
			case 'playlist.resume':
				player.resume();
				return;
			case 'playlist.forget':
				player.forget();
				return;
			case 'playlist.customize': {
				const { title, gain, crossfade, fadeIn, fadeOut, order, trackLooping, stopMode } = command;
				const playlist = loaded.library.updatePlaylist(player.id, { title, gain, crossfade, fadeIn, fadeOut, order, trackLooping, stopMode });
				if (gain !== undefined) {
					player.setGain(playlist.gain);
				}
				if ([crossfade, fadeIn, fadeOut, order, trackLooping, stopMode].some((value) => value !== undefined)) {
					player.setRules(resolvePlaybackRules(playlist));
				}
				this.#optionsSync.schedule({ kind: 'playlist', id: playlist.id }, {
					title: playlist.title,
					gain: playlist.gain,
					crossfade: playlist.crossfade,
					fadeIn: playlist.fadeIn,
					fadeOut: playlist.fadeOut,
					order: playlist.order,
					trackLooping: playlist.trackLooping,
					stopMode: playlist.stopMode,
				});
				this.#events.emit({ type: 'playlist.changed', playlist });
				return;
			}
		}
	}

	/** @param {string} soundId */
	playSound(soundId) {
		this.dispatch({ type: 'sound.play', soundId });
	}

	/** @param {string} soundId */
	stopSound(soundId) {
		this.dispatch({ type: 'sound.stop', soundId });
	}

	/** @param {string} playlistId */
	togglePlaylist(playlistId) {
		this.dispatch({ type: 'playlist.toggle', playlistId });
	}

	/**
	 * @param {string} playlistId
	 * @param {TransitionOptions} [options]
	 */
	playPlaylist(playlistId, { transition } = {}) {
		this.dispatch({ type: 'playlist.play', playlistId, transition });
	}

	/**
	 * @param {string} playlistId
	 * @param {TransitionOptions} [options]
	 */
	stopPlaylist(playlistId, { transition } = {}) {
		this.dispatch({ type: 'playlist.stop', playlistId, transition });
	}

	/**
	 * @param {string} playlistId
	 * @param {TransitionOptions} [options]
	 */
	nextTrack(playlistId, { transition } = {}) {
		this.dispatch({ type: 'playlist.next', playlistId, transition });
	}

	/**
	 * @param {string} playlistId
	 * @param {TransitionOptions} [options]
	 */
	previousTrack(playlistId, { transition } = {}) {
		this.dispatch({ type: 'playlist.previous', playlistId, transition });
	}

	/**
	 * @param {string} playlistId
	 * @param {number} trackIndex
	 * @param {TransitionOptions} [options]
	 */
	jumpToTrack(playlistId, trackIndex, { transition } = {}) {
		this.dispatch({ type: 'playlist.jump', playlistId, trackIndex, transition });
	}

	/**
	 * @param {string} playlistId
	 * @param {number} seconds
	 */
	seek(playlistId, seconds) {
		this.dispatch({ type: 'playlist.seek', playlistId, seconds });
	}

	/** @param {string} playlistId */
	pausePlaylist(playlistId) {
		this.dispatch({ type: 'playlist.pause', playlistId });
	}

	/** @param {string} playlistId */
	resumePlaylist(playlistId) {
		this.dispatch({ type: 'playlist.resume', playlistId });
	}

	/**
	 * @param {Bus} bus
	 * @param {number} value slider position, 0..1
	 */
	setVolume(bus, value) {
		this.dispatch({ type: 'volume.set', bus, value });
	}

	/**
	 * Changes a sound's title, gain, start and end points or fades. The change takes effect at once, and is saved to the
	 * server shortly after (`sound.saved` or `sound.saveFailed`). A new gain also reaches instances already playing; new
	 * points and fades only later presses.
	 * @param {string} soundId
	 * @param {ItemOptions} changes a title must not be empty; a gain is linear, from 0 to MAX_GAIN; the points are in
	 * 	seconds, at least MIN_CLIP_MS apart, and a null end point means the end of the file; the fades are in seconds, from
	 * 	0 to MAX_CROSSFADE
	 */
	customizeSound(soundId, { title, gain, startAt, endAt, fadeIn, fadeOut }) {
		this.dispatch({ type: 'sound.customize', soundId, title, gain, startAt, endAt, fadeIn, fadeOut });
	}

	/**
	 * Like `customizeSound`, for a playlist: a new gain reaches its playing and fading tracks at once, and new timings
	 * are used from the next change of track, start or stop. A new order refills the history around the current track
	 * (DESIGN.md §8.1), and track looping applies to the current track at once. A new stop mode trims what a stopped
	 * playlist remembers. Saving is reported with `playlist.saved` or `playlist.saveFailed`.
	 * @param {string} playlistId
	 * @param {ItemOptions} changes `crossfade`, `fadeIn` and `fadeOut` in seconds, from 0 to MAX_CROSSFADE; `order` one of
	 * 	PLAYBACK_ORDERS; `stopMode` one of STOP_MODES
	 */
	customizePlaylist(playlistId, { title, gain, crossfade, fadeIn, fadeOut, order, trackLooping, stopMode }) {
		this.dispatch({ type: 'playlist.customize', playlistId, title, gain, crossfade, fadeIn, fadeOut, order, trackLooping, stopMode });
	}

	/**
	 * Makes a stopped playlist forget the track and position it would resume at, so it starts afresh.
	 * @param {string} playlistId
	 */
	forgetPlaylist(playlistId) {
		this.dispatch({ type: 'playlist.forget', playlistId });
	}

	/**
	 * Renames a track. It is announced as `playlist.changed` with its playlist, so every view of the playlist follows;
	 * saving is reported with `track.saved` or `track.saveFailed`.
	 * @param {string} trackId
	 * @param {{ title: string }} changes the title must not be empty
	 */
	customizeTrack(trackId, { title }) {
		this.dispatch({ type: 'track.customize', trackId, title });
	}

	/** @returns {LibraryJson | null} null until started */
	getLibrary() {
		return this.#loaded?.library.json ?? null;
	}

	/** @param {string} playlistId */
	getPlaylistSnapshot(playlistId) {
		return this.#player(playlistId).snapshot();
	}

	/** @returns {PlaylistSnapshot[]} in the order the playlists were started */
	getActivePlaylists() {
		return this.#activeOrder.map((id) => this.#player(id).snapshot());
	}

	getVolumes() {
		return this.#volume.volumes;
	}

	/** @param {string} soundId */
	isSoundActive(soundId) {
		return this.#loaded?.sounds.isActive(soundId) ?? false;
	}

	async #load() {
		try {
			const [libraryJson, settings] = await Promise.all([this.#api.fetchLibrary(), this.#api.fetchSettings()]);
			const library = new LibraryModel(libraryJson, (format) => this.#engine.canPlay(format));
			const isPlayable = (/** @type {import('./ports.js').AudioFileJson} */ file) => library.isPlayable(file);
			const emit = (/** @type {SoundboardEvent} */ event) => this.#events.emit(event);

			this.#volume.applyAll(settings.volumes);
			const sounds = new SoundPlayer({
				engine: this.#engine,
				clock: this.#clock,
				cache: new BufferCache({ load: (url) => this.#engine.loadBuffer(url) }),
				emit,
				isPlayable,
			});
			const playlists = new Map(libraryJson.playlists.map((playlist) => [playlist.id, new PlaylistPlayer({
				playlist,
				engine: this.#engine,
				clock: this.#clock,
				emit: (event) => this.#onPlaylistEvent(event),
				isPlayable,
				random: this.#random,
			})]));

			this.#loaded = { library, sounds, playlists };
			emit({ type: 'app.ready', library: libraryJson, volumes: this.#volume.volumes, unplayable: library.unplayable });
		} catch (error) {
			this.#starting = null;
			const message = error instanceof Error ? error.message : String(error);
			this.#logger.error('Could not start the soundboard', error);
			this.#events.emit({ type: 'app.startFailed', message });
		}
	}

	/** @param {PlaylistEvent} event */
	#onPlaylistEvent(event) {
		if (event.type === 'playlist.stateChanged') {
			const isListed = this.#activeOrder.includes(event.playlistId);
			if (event.state === 'idle') {
				this.#activeOrder = this.#activeOrder.filter((id) => id !== event.playlistId);
			} else if (!isListed) {
				this.#activeOrder.push(event.playlistId);
			}
		}
		this.#events.emit(event);
	}

	/** @param {string} playlistId */
	#player(playlistId) {
		const loaded = this.#loaded;
		if (!loaded) {
			throw new NotReadyError();
		}
		const player = loaded.playlists.get(playlistId);
		if (!player) {
			throw new InvalidCommandError(`Unknown playlist "${playlistId}"`);
		}
		return player;
	}
}
