import { BufferCache } from './buffer-cache.js';
import { validateCommand } from './commands.js';
import { InvalidCommandError, NotReadyError } from './errors.js';
import { EventEmitter } from './event-emitter.js';
import { LibraryModel } from './library-model.js';
import { OptionsSync } from './options-sync.js';
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
/** @typedef {import('./ports.js').SoundOptions} SoundOptions */
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
 * 	| { type: 'sound.saveFailed', soundId: string, message: string }} CustomizeEvent
 * @typedef {AppEvent | SoundEvent | PlaylistEvent | VolumeChangedEvent | CustomizeEvent} SoundboardEvent
 */

/** @typedef {{ transition?: Transition }} TransitionOptions */

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
	 */
	constructor({ engine, clock, api, logger }) {
		this.#engine = engine;
		this.#clock = clock;
		this.#api = api;
		this.#logger = logger;
		this.#events = new EventEmitter((error, event) => logger.error(`A handler for ${event.type} failed`, error));
		const emit = (/** @type {SoundboardEvent} */ event) => this.#events.emit(event);
		this.#volume = new VolumeControl({ setBusGain: (bus, gain) => engine.setBusGain(bus, gain), emit });
		this.#settingsSync = new SettingsSync({ saveVolumes: (volumes, options) => api.saveVolumes(volumes, options), clock, logger });
		this.#optionsSync = new OptionsSync({
			save: (soundId, options, request) => api.saveSoundOptions(soundId, options, request),
			clock,
			onSaved: (soundId) => emit({ type: 'sound.saved', soundId }),
			onFailed: (soundId, error) => {
				logger.warn(`Could not save the options of ${soundId}; they will be saved with the next change.`, error);
				emit({ type: 'sound.saveFailed', soundId, message: error.message });
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
		this.#optionsSync.flush(soundId);
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
			case 'sound.customize': {
				const sound = loaded.library.updateSound(command.soundId, { title: command.title, gain: command.gain });
				if (command.gain !== undefined) {
					loaded.sounds.setGain(sound.id, sound.gain);
				}
				this.#optionsSync.schedule(sound.id, { title: sound.title, gain: sound.gain });
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
	 * Changes a sound's title or gain. The change takes effect at once, also on instances already playing, and is saved
	 * to the server shortly after (`sound.saved` or `sound.saveFailed`).
	 * @param {string} soundId
	 * @param {SoundOptions} changes a title must not be empty; a gain is linear, from 0 to MAX_GAIN
	 */
	customizeSound(soundId, { title, gain }) {
		this.dispatch({ type: 'sound.customize', soundId, title, gain });
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
