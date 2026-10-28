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
import { VoiceMonitor } from './voice-monitor.js';
import { WaveformService } from './waveform-service.js';
import { VolumeControl } from './volume.js';

/** @typedef {import('./ports.js').AudioEngine} AudioEngine */
/** @typedef {import('./ports.js').BackendApi} BackendApi */
/** @typedef {import('./ports.js').Bus} Bus */
/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./ports.js').LibraryJson} LibraryJson */
/** @typedef {import('./ports.js').Logger} Logger */
/** @typedef {import('./ports.js').ServerEvents} ServerEvents */
/** @typedef {import('./ports.js').Volumes} Volumes */
/** @typedef {import('./ports.js').WaveformDecoder} WaveformDecoder */
/** @typedef {import('./waveform-service.js').WaveformEvent} WaveformEvent */
/** @typedef {import('./waveform-service.js').WaveformStatus} WaveformStatus */
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
 * @typedef {{ type: 'voices.changed' }} VoicesEvent
 * @typedef {{ type: 'library.externalChanges', pending: boolean }
 * 	| { type: 'library.refreshing' }
 * 	| { type: 'library.refreshed' }
 * 	| { type: 'library.refreshFailed', message: string, errors: { path: string, message: string }[], restartNeeded: boolean }} RefreshEvent
 * @typedef {AppEvent | SoundEvent | PlaylistEvent | VolumeChangedEvent | CustomizeEvent | VoicesEvent | WaveformEvent | RefreshEvent} SoundboardEvent
 */

/** @typedef {{ transition?: Transition }} TransitionOptions */
/** @typedef {import('./options-sync.js').ItemRef['kind']} ItemKind */

/**
 * The application API the UI talks to (DESIGN.md §6.1): commands in, events out. Every method is a thin wrapper that
 * builds a command and dispatches it, so a remote control can drive the same paths.
 */
export class Soundboard {
	#engine;
	#monitor;
	#clock;
	#api;
	#logger;
	/** @type {EventEmitter<SoundboardEvent>} */
	#events;
	#volume;
	#settingsSync;
	#optionsSync;
	#random;
	#decoder;
	/** @type {WaveformService | null} */
	#waveforms = null;
	/** @type {{ library: LibraryModel, sounds: SoundPlayer, playlists: Map<string, PlaylistPlayer> } | null} */
	#loaded = null;
	/** @type {Promise<void> | null} */
	#starting = null;
	/** Ids of non-idle playlists, in the order they started. @type {string[]} */
	#activeOrder = [];
	/** @type {ServerEvents | undefined} */
	#serverEvents;
	#externalChanges = false;
	#checkingChanges = false;
	#refreshing = false;

	/**
	 * @param {object} ports
	 * @param {AudioEngine} ports.engine
	 * @param {Clock} ports.clock
	 * @param {BackendApi} ports.api
	 * @param {Logger} ports.logger
	 * @param {() => number} [ports.random] for the random playback orders; tests pass a seeded generator
	 * @param {WaveformDecoder} ports.decoder
	 * @param {ServerEvents} [ports.serverEvents] the server's pushed messages; without it external changes are only
	 * 	found by `checkExternalChanges`
	 */
	constructor({ engine, clock, api, logger, decoder, serverEvents, random = Math.random }) {
		this.#serverEvents = serverEvents;
		this.#decoder = decoder;
		this.#clock = clock;
		this.#random = random;
		this.#api = api;
		this.#logger = logger;
		this.#events = new EventEmitter((error, event) => logger.error(`A handler for ${event.type} failed`, error));
		const emit = (/** @type {SoundboardEvent} */ event) => this.#events.emit(event);
		// Every voice the players make goes through the monitor, which records what the debug view shows (§6.5).
		this.#monitor = new VoiceMonitor({ engine, clock, onChange: () => emit({ type: 'voices.changed' }) });
		this.#engine = this.#monitor;
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
				const { title, gain, startAt, endAt } = command;
				const { playlist, track } = loaded.library.updateTrack(command.trackId, { title, gain, startAt, endAt });
				loaded.playlists.get(playlist.id)?.setPlaylist(playlist);
				this.#optionsSync.schedule({ kind: 'track', id: track.id }, { title: track.title, gain: track.gain, startAt: track.startAt, endAt: track.endAt });
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
	 * Renames a track or changes its volume or its start and end points (`endAt: null` is the end of the file). It is announced as
	 * `playlist.changed` with its playlist, so every view of the playlist follows; saving is reported with `track.saved`
	 * or `track.saveFailed`.
	 * @param {string} trackId
	 * @param {{ title?: string, gain?: number, startAt?: number, endAt?: number | null }} changes the title must not be empty
	 */
	customizeTrack(trackId, { title, gain, startAt, endAt }) {
		this.dispatch({ type: 'track.customize', trackId, title, gain, startAt, endAt });
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

	/**
	 * Every voice the audio engine has been given and that is still playing or finished less than 5 seconds ago, oldest
	 * first, as it is right now (DESIGN.md §6.5). Read it again to see volumes move; `voices.changed` says when the
	 * list itself or a status changed.
	 * @returns {import('./voice-monitor.js').VoiceInfo[]}
	 */
	getVoices() {
		return this.#monitor.voices();
	}

	/** Starts generating the missing waveforms, which also happens by itself once the library has loaded (§6.6). */
	startWaveforms() {
		this.#waveforms?.start();
	}

	/** Stops generating after the file being decoded; playback is never affected either way. */
	stopWaveforms() {
		this.#waveforms?.stop();
	}

	/** @returns {WaveformStatus} */
	getWaveformStatus() {
		return this.#waveforms?.status ?? { running: false, done: 0, total: 0, failed: 0 };
	}

	/**
	 * @param {string} id a sound or track
	 * @returns {Promise<Int8Array | null>} min/max byte pairs, or null while there is no waveform yet (`waveform.ready` follows)
	 */
	getWaveform(id) {
		return this.#waveforms?.get(id) ?? Promise.resolve(null);
	}

	/** Whether the server reported files changed outside the app since the library was loaded. */
	hasExternalChanges() {
		return this.#externalChanges;
	}

	/**
	 * Asks the server to look for external changes now, by size and date only; call it when the page gets the focus
	 * back. The answer arrives as `library.externalChanges`. Does nothing before the library has loaded or while a check
	 * is already running.
	 */
	checkExternalChanges() {
		if (!this.#loaded || this.#checkingChanges) {
			return;
		}
		this.#checkingChanges = true;
		this.#api.checkExternalChanges().then(
			(pending) => this.#setExternalChanges(pending),
			(error) => this.#logger.warn('Could not check the audio directory for external changes.', error),
		).finally(() => {
			this.#checkingChanges = false;
		});
	}

	/**
	 * Has the server rebuild its library from the files, as a restart would. Pending saves are sent and awaited first,
	 * so the rebuild reads the latest edits. Reports `library.refreshing`, then `library.refreshed` (the page should
	 * reload to show the new library) or `library.refreshFailed`.
	 * @returns {Promise<void>}
	 */
	async refreshLibrary() {
		if (this.#refreshing) {
			return;
		}
		this.#refreshing = true;
		this.#events.emit({ type: 'library.refreshing' });
		try {
			await Promise.all([this.#settingsSync.settle(), this.#optionsSync.settleAll()]);
			const result = await this.#api.refresh();
			if (result.status === 'refreshed') {
				this.#events.emit({ type: 'library.refreshed' });
			} else if (result.status === 'invalid') {
				this.#events.emit({ type: 'library.refreshFailed', message: 'Some options files are invalid.', errors: result.errors, restartNeeded: false });
			} else {
				this.#events.emit({ type: 'library.refreshFailed', message: result.message, errors: [], restartNeeded: true });
			}
		} catch (error) {
			this.#logger.error('Could not refresh the library', error);
			const message = error instanceof Error ? error.message : String(error);
			this.#events.emit({ type: 'library.refreshFailed', message, errors: [], restartNeeded: false });
		} finally {
			this.#refreshing = false;
		}
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
			const urls = new Map([...libraryJson.sounds, ...libraryJson.playlists.flatMap((playlist) => playlist.tracks)].map((file) => [file.id, file.url]));
			this.#waveforms = new WaveformService({
				api: this.#api,
				decoder: this.#decoder,
				clock: this.#clock,
				logger: this.#logger,
				emit,
				urlOf: (id) => urls.get(id),
			});
			emit({ type: 'app.ready', library: libraryJson, volumes: this.#volume.volumes, unplayable: library.unplayable });
			this.#waveforms.start();
			this.#serverEvents?.connect((message) => this.#onServerMessage(message));
		} catch (error) {
			this.#starting = null;
			const message = error instanceof Error ? error.message : String(error);
			this.#logger.error('Could not start the soundboard', error);
			this.#events.emit({ type: 'app.startFailed', message });
		}
	}

	/** @param {import('./ports.js').ServerMessage} message */
	#onServerMessage(message) {
		if (message.type === 'externalChanges') {
			this.#setExternalChanges(message.pending);
		}
	}

	/** @param {boolean} pending */
	#setExternalChanges(pending) {
		if (pending !== this.#externalChanges) {
			this.#externalChanges = pending;
			this.#events.emit({ type: 'library.externalChanges', pending });
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
