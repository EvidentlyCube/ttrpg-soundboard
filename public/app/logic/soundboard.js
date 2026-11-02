import { BufferCache } from './buffer-cache.js';
import { validateCommand } from './commands.js';
import { InvalidCommandError, NotReadyError } from './errors.js';
import { EventEmitter } from './event-emitter.js';
import { LibraryModel } from './library-model.js';
import { OptionsSync } from './options-sync.js';
import { resolvePlaybackRules } from './playback-rules.js';
import { PlaylistPlayer } from './playlist-player.js';
import { buildRemoteState } from './remote-state.js';
import { ProblemList } from './problem-list.js';
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
 * 	| { type: 'audio.resumed' }
 * 	| { type: 'panic.changed', state: PanicState }
 * 	| { type: 'host.changed', hosting: boolean }} AppEvent
 * `panic.changed`: Panic Stop moved between its two states (`panicState()`). `host.changed`: this page became the host that
 * remotes control, or stopped being it (DESIGN.md §6.10).
 * @typedef {{ type: 'playlist.levelChanged', playlistId: string, level: number }} LevelEvent
 * `playlist.levelChanged`: a playlist's live level (DESIGN.md §6.4) changed; `level` is a slider position, 0..1.
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
 * 	| { type: 'library.refreshFailed', message: string, errors: { path: string, message: string }[], restartNeeded: boolean }
 * 	| { type: 'trash.changed', size: number, count: number }
 * 	| { type: 'problems.changed', count: number }
 * 	| { type: 'access.requestsChanged', requests: import('./ports.js').AccessRequest[] }} RefreshEvent
 * @typedef {AppEvent | LevelEvent | SoundEvent | PlaylistEvent | VolumeChangedEvent | CustomizeEvent | VoicesEvent | WaveformEvent
 * 	| RefreshEvent | DownloadEvent} SoundboardEvent
 */

/** @typedef {import('./ports.js').DownloadJob} DownloadJob */
/** @typedef {import('./ports.js').DownloadTools} DownloadTools */
/**
 * @typedef {{ type: 'download.changed', job: DownloadJob | null, logReset: boolean }
 * 	| { type: 'download.log', lines: string[], replaceLast: boolean }
 * 	| { type: 'sound.added', sound: AudioFileJson }
 * 	| { type: 'playlist.added', playlist: PlaylistJson }
 * 	| { type: 'sound.removed', soundId: string }
 * 	| { type: 'playlist.removed', playlistId: string }} DownloadEvent `logReset`: read the whole log again with
 * 	`getDownload()`; otherwise `download.log` brings what is new. Additions and removals come from downloads, deletions
 * 	and moves.
 */

/**
 * What the next press of Panic Stop does: `'fade'` fades everything out with its own fade-out, `'now'` (only while
 * everything playing is fading out) stops it all at once.
 * @typedef {'fade' | 'now'} PanicState
 */

/** @typedef {{ library: LibraryModel, sounds: SoundPlayer, cache: BufferCache, playlists: Map<string, PlaylistPlayer> }} Loaded */

/** How often Panic Stop in `'now'` checks whether the fades are over or something new has started. */
const PANIC_CHECK_MS = 100;

/** How long becoming the host waits for the page's event stream to open before it gives up. */
const STREAM_WAIT_MS = 5000;

/** What `becomeHost` found: `'taken'` means another page is the host and was not asked to give way. */
/** @typedef {'hosting' | 'taken' | 'failed'} HostResult */

/** As many log lines as the server keeps (DESIGN.md §5.4). */
const MAX_DOWNLOAD_LOG = 1000;

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
	/** @type {Loaded | null} */
	#loaded = null;
	/** @type {Promise<void> | null} */
	#starting = null;
	/** Ids of non-idle playlists, in the order they started. @type {string[]} */
	#activeOrder = [];
	/** @type {ServerEvents | undefined} */
	#serverEvents;
	#externalChanges = false;
	/** @type {import('./ports.js').TrashSummary} */
	#trash = { size: 0, count: 0 };
	#problems = new ProblemList();
	/** @type {import('./ports.js').AccessRequest[]} */
	#accessRequests = [];
	/** Id of the download job whose failures are listed already. @type {string | null} */
	#reportedJob = null;
	#checkingChanges = false;
	#refreshing = false;
	/** Media URLs by sound or track id, for the waveforms. @type {Map<string, string>} */
	#urls = new Map();
	/** @type {DownloadTools} */
	#downloadTools = { ytDlp: null, ffmpeg: null };
	/** @type {DownloadJob | null} */
	#download = null;
	/** @type {string[]} */
	#downloadLog = [];
	/** @type {PanicState} */
	#panic = 'fade';
	/** @type {number | null} */
	#panicTimer = null;
	/** Sent with this page's event stream, so the server can reach it (DESIGN.md §5). */
	#pageId;
	#hosting = false;
	/** Whether the event stream has told the page what its role is, which is when the server can reach it. */
	#streamOpen = false;
	/** @type {{ resolve: () => void, reject: (error: Error) => void, timer: number }[]} */
	#streamWaiters = [];
	/** @type {Promise<HostResult> | null} */
	#claiming = null;
	/** @type {number | null} */
	#remoteStateTimer = null;
	/** Whether a state is on its way to the server, and whether something changed since it was built. */
	#remoteStateSending = false;
	#remoteStateStale = false;
	/** Sounds with a live instance, for the remotes. @type {Set<string>} */
	#activeSounds = new Set();

	/**
	 * @param {object} ports
	 * @param {AudioEngine} ports.engine
	 * @param {Clock} ports.clock
	 * @param {BackendApi} ports.api
	 * @param {Logger} ports.logger
	 * @param {() => number} [ports.random] for the random playback orders; tests pass a seeded generator
	 * @param {WaveformDecoder} ports.decoder
 * @param {string} [ports.pageId] tells this page's event stream from the other pages'; made up when left out
	 * @param {ServerEvents} [ports.serverEvents] the server's pushed messages; without it external changes are only
	 * 	found by `checkExternalChanges`
	 */
	constructor({ engine, clock, api, logger, decoder, serverEvents, random = Math.random, pageId }) {
		this.#pageId = pageId ?? `page-${Math.floor(random() * 1e12).toString(36)}-${Math.floor(clock.now()).toString(36)}`;
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
		this.#listenForProblems();
		this.#listenForRemoteState();
	}

	/** Lists what the page itself finds wrong (DESIGN.md §6.1), from the events it announces anyway. */
	#listenForProblems() {
		/**
		 * @param {string} kind
		 * @param {string} path
		 * @param {string} message
		 */
		const record = (kind, path, message) => {
			this.#problems.record({ kind, path, message });
			this.#announceProblems();
		};
		/**
		 * @param {string} path
		 */
		const resolveSave = (path) => {
			this.#problems.resolve('save-failed', path);
			this.#announceProblems();
		};
		const events = this.#events;
		events.on('sound.error', ({ soundId, message }) => record('play-failed', soundId, message));
		events.on('playlist.error', ({ playlistId, trackId, message }) => record('play-failed', trackId ?? playlistId, message));
		events.on('sound.saveFailed', ({ soundId, message }) => record('save-failed', soundId, message));
		events.on('playlist.saveFailed', ({ playlistId, message }) => record('save-failed', playlistId, message));
		events.on('track.saveFailed', ({ trackId, message }) => record('save-failed', trackId, message));
		events.on('sound.saved', ({ soundId }) => resolveSave(soundId));
		events.on('playlist.saved', ({ playlistId }) => resolveSave(playlistId));
		events.on('track.saved', ({ trackId }) => resolveSave(trackId));
		events.on('sound.removed', ({ soundId }) => this.#forgetProblems(soundId));
		events.on('playlist.removed', ({ playlistId }) => this.#forgetProblems(playlistId));
		events.on('download.changed', ({ job }) => {
			if (job?.state !== 'failed' || job.id === this.#reportedJob) {
				return;
			}
			this.#reportedJob = job.id;
			for (const item of job.items) {
				if (item.state === 'failed') {
					record('download-failed', item.title, item.error ?? 'The download failed.');
				}
			}
		});
	}

	/**
	 * Sends the remotes a new state after anything they show has changed (DESIGN.md §6.10). Changes that follow each other
	 * are sent as one.
	 */
	#listenForRemoteState() {
		const events = this.#events;
		events.on('sound.activeChanged', ({ soundId, active }) => {
			if (active) {
				this.#activeSounds.add(soundId);
			} else {
				this.#activeSounds.delete(soundId);
			}
		});
		for (const type of /** @type {const} */ ([
			'sound.activeChanged', 'playlist.stateChanged', 'panic.changed', 'sound.changed', 'playlist.changed', 'sound.added',
			'playlist.added', 'sound.removed', 'playlist.removed',
		])) {
			events.on(type, () => this.#queueRemoteState());
		}
	}

	#queueRemoteState() {
		if (!this.#hosting || this.#remoteStateTimer !== null) {
			return;
		}
		this.#remoteStateTimer = this.#clock.setTimeout(() => {
			this.#remoteStateTimer = null;
			this.#sendRemoteState();
		}, 0);
	}

	#sendRemoteState() {
		const loaded = this.#loaded;
		if (!this.#hosting || !loaded) {
			return;
		}
		// One at a time, or two requests could reach the server out of order and leave the remotes with the older state.
		if (this.#remoteStateSending) {
			this.#remoteStateStale = true;
			return;
		}
		this.#remoteStateSending = true;
		const state = buildRemoteState({
			panic: this.#panic,
			library: loaded.library.json,
			isPlayable: (file) => loaded.library.isPlayable(file),
			active: this.getActivePlaylists(),
			activeSounds: [...this.#activeSounds],
		});
		this.#api.sendRemoteState(this.#pageId, state)
			.catch((error) => this.#logger.warn('Could not send the state to the remotes.', error))
			.finally(() => {
				this.#remoteStateSending = false;
				if (this.#remoteStateStale) {
					this.#remoteStateStale = false;
					this.#sendRemoteState();
				}
			});
	}

	/** @param {string} path */
	#forgetProblems(path) {
		this.#problems.forget(path);
		this.#announceProblems();
	}

	#announceProblems() {
		this.#events.emit({ type: 'problems.changed', count: this.#problems.list.length });
	}

	/**
	 * Everything wrong that is known: the server's problems from startup, and this page's own (failed saves, tracks
	 * that would not play, failed downloads). `problems.changed` announces every change.
	 * @returns {import('./problem-list.js').ProblemJson[]}
	 */
	getProblems() {
		return this.#problems.list;
	}

	/**
	 * Removes one problem from the list; the server forgets its own for good until the next start or refresh.
	 * @param {string} id
	 */
	dismissProblem(id) {
		if (this.#problems.dismiss(id) === 'server') {
			this.#api.dismissProblem(id).catch((error) => this.#logger.warn('Could not dismiss a problem on the server.', error));
		}
		this.#announceProblems();
	}

	dismissAllProblems() {
		if (this.#problems.clear()) {
			this.#api.dismissAllProblems().catch((error) => this.#logger.warn('Could not dismiss the problems on the server.', error));
		}
		this.#announceProblems();
	}

	/** @returns {boolean} whether remotes control this page (DESIGN.md §6.10) */
	isHosting() {
		return this.#hosting;
	}

	/**
	 * Asks the server to make this page the host that remotes control. Without `replace`, another host is left alone and
	 * the answer is `'taken'`; the page asks again with `replace` once the user has confirmed. A failure leaves the page as
	 * it was and is listed among the problems as a warning. Needs the board to be loaded.
	 * @param {{ replace?: boolean }} [options]
	 * @returns {Promise<HostResult>}
	 */
	becomeHost({ replace = false } = {}) {
		if (this.#hosting) {
			return Promise.resolve('hosting');
		}
		this.#claiming ??= this.#claim(replace).finally(() => {
			this.#claiming = null;
		});
		return this.#claiming;
	}

	/**
	 * @param {boolean} replace
	 * @returns {Promise<HostResult>}
	 */
	async #claim(replace) {
		try {
			await this.#waitForStream();
			if (await this.#api.claimHost(this.#pageId, { replace }) === 'taken') {
				return 'taken';
			}
		} catch (error) {
			this.#logger.warn('Could not become the host.', error);
			this.#problems.record({
				kind: 'host-failed',
				path: 'host',
				message: error instanceof Error ? error.message : String(error),
				severity: 'warning',
			});
			this.#announceProblems();
			return 'failed';
		}
		this.#problems.resolve('host-failed', 'host');
		this.#problems.resolve('host-lost', 'host');
		this.#announceProblems();
		this.#hosting = true;
		this.#events.emit({ type: 'host.changed', hosting: true });
		this.#queueRemoteState();
		return 'hosting';
	}

	/** Resolves once the server can reach this page, which it can when the first message of the stream has arrived. */
	#waitForStream() {
		if (!this.#serverEvents || this.#streamOpen) {
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const waiter = {
				resolve: () => {
					this.#clock.clearTimeout(waiter.timer);
					resolve(undefined);
				},
				reject,
				timer: this.#clock.setTimeout(() => {
					this.#streamWaiters = this.#streamWaiters.filter((entry) => entry !== waiter);
					reject(new Error('The page is not connected to the server'));
				}, STREAM_WAIT_MS),
			};
			this.#streamWaiters.push(waiter);
		});
	}

	/**
	 * Gives up the host role, so the remotes see no host until a page asks again.
	 * @param {{ keepalive?: boolean }} [options] `keepalive` lets the request finish while the page is closing
	 */
	stopHosting({ keepalive = false } = {}) {
		if (!this.#hosting) {
			return;
		}
		this.#hosting = false;
		this.#events.emit({ type: 'host.changed', hosting: false });
		this.#api.releaseHost(this.#pageId, { keepalive }).catch((error) => this.#logger.warn('Could not give up the host role.', error));
	}

	/**
	 * The server says this page is not the host (any more): another page took over, or the connection was lost for too
	 * long. The page carries on as it is, and the problems list says what happened.
	 * @param {string} message
	 */
	#loseHost(message) {
		this.#hosting = false;
		this.#problems.record({ kind: 'host-lost', path: 'host', message });
		this.#announceProblems();
		this.#events.emit({ type: 'host.changed', hosting: false });
	}

	/** @param {import('./ports.js').ServerMessage & { type: 'remote.role' }} message */
	#onRole(message) {
		this.#streamOpen = true;
		for (const waiter of this.#streamWaiters.splice(0)) {
			waiter.resolve();
		}
		if (message.host) {
			if (this.#hosting) {
				// Back after a short disconnection: the remotes may have missed changes.
				this.#queueRemoteState();
			}
			return;
		}
		if (this.#hosting) {
			this.#loseHost(message.reason === 'replaced'
				? 'Another page took over as host.'
				: 'This page was disconnected from the server for too long, so it is not the host any more.');
		}
	}

	/**
	 * A command from a remote, run as if it had been given here. A command that fails (an id that is gone) is only logged.
	 * @param {unknown} command
	 */
	#onRemoteCommand(command) {
		if (!this.#hosting) {
			return;
		}
		try {
			this.dispatch(command);
		} catch (error) {
			this.#logger.warn('A command from a remote failed.', error);
		}
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
			case 'panic.stop':
				this.#panicStop(loaded);
				return;
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
			case 'playlist.setLevel': {
				const level = clampLevel(command.level);
				if (level !== player.level) {
					player.setLevel(level);
					this.#events.emit({ type: 'playlist.levelChanged', playlistId: player.id, level });
				}
				return;
			}
			case 'playlist.customize': {
				const { title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode } = command;
				const playlist = loaded.library.updatePlaylist(player.id, { title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode });
				if (gain !== undefined) {
					player.setGain(playlist.gain);
				}
				if ([crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode].some((value) => value !== undefined)) {
					player.setRules(resolvePlaybackRules(playlist));
				}
				this.#optionsSync.schedule({ kind: 'playlist', id: playlist.id }, {
					title: playlist.title,
					gain: playlist.gain,
					crossfade: playlist.crossfade,
					fadeIn: playlist.fadeIn,
					fadeOut: playlist.fadeOut,
					order: playlist.order,
					playlistLooping: playlist.playlistLooping,
					trackLooping: playlist.trackLooping,
					stopMode: playlist.stopMode,
				});
				this.#events.emit({ type: 'playlist.changed', playlist });
				return;
			}
		}
	}

	/**
	 * The Panic Stop button. In `'fade'` it stops everything the way a normal stop does, each playlist and sound with
	 * its own fade-out, and moves to `'now'` if anything is left fading. In `'now'` it stops everything at once.
	 */
	panicStop() {
		this.dispatch({ type: 'panic.stop' });
	}

	/** @returns {PanicState} */
	panicState() {
		return this.#panic;
	}

	/** @param {Loaded} loaded */
	#panicStop(loaded) {
		if (this.#panic === 'now') {
			for (const player of loaded.playlists.values()) {
				player.silence();
			}
			loaded.sounds.stopAll();
			this.#setPanic('fade');
			return;
		}
		for (const player of loaded.playlists.values()) {
			player.stop();
		}
		loaded.sounds.fadeStopAll();
		this.#checkPanic();
	}

	/**
	 * In `'now'`, back to `'fade'` as soon as nothing is fading out any more, or anything is playing that is not.
	 * Checked on a timer, since the players do not announce when a fade ends.
	 */
	#checkPanic() {
		const loaded = this.#loaded;
		if (!loaded) {
			return;
		}
		const players = [...loaded.playlists.values()];
		const sounds = loaded.sounds.count();
		const fading = players.some((player) => player.fadingOut) || sounds.fading > 0;
		const steady = players.some((player) => player.state !== 'idle') || sounds.steady > 0;
		if (fading && !steady) {
			if (this.#panicTimer === null) {
				this.#panicTimer = this.#clock.setInterval(() => this.#checkPanic(), PANIC_CHECK_MS);
			}
			this.#setPanic('now');
			return;
		}
		if (this.#panicTimer !== null) {
			this.#clock.clearInterval(this.#panicTimer);
			this.#panicTimer = null;
		}
		this.#setPanic('fade');
	}

	/** @param {PanicState} state */
	#setPanic(state) {
		if (state === this.#panic) {
			return;
		}
		this.#panic = state;
		if (state === 'fade' && this.#panicTimer !== null) {
			this.#clock.clearInterval(this.#panicTimer);
			this.#panicTimer = null;
		}
		this.#events.emit({ type: 'panic.changed', state });
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
	 * Sets a playlist's temporary live level (DESIGN.md §6.4). It is not saved and outlives stops and track changes.
	 * @param {string} playlistId
	 * @param {number} level slider position, 0..1
	 */
	setPlaylistLevel(playlistId, level) {
		this.dispatch({ type: 'playlist.setLevel', playlistId, level });
	}

	/**
	 * @param {string} playlistId
	 * @returns {number} slider position, 0..1
	 */
	getPlaylistLevel(playlistId) {
		return this.#player(playlistId).level;
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
	customizePlaylist(playlistId, { title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode }) {
		this.dispatch({ type: 'playlist.customize', playlistId, title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode });
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

	/**
	 * Makes every sound's and track's waveform again, replacing the stored ones (DESIGN.md §6.6): sounds first, then
	 * tracks in playlist order, as missing ones are made. Progress arrives as `waveforms.progress`.
	 */
	regenerateWaveforms() {
		const library = this.#loaded?.library.json;
		if (!library || !this.#waveforms) {
			return;
		}
		this.#waveforms.regenerate([...library.sounds, ...library.playlists.flatMap((playlist) => playlist.tracks)].map((file) => file.id));
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

	/**
	 * Devices on the network that ask to be paired (DESIGN.md §5.6), as the server last reported them. Empty without
	 * `--lan`. `access.requestsChanged` announces every change.
	 * @returns {import('./ports.js').AccessRequest[]}
	 */
	accessRequests() {
		return this.#accessRequests;
	}

	/**
	 * @returns {Promise<string[]>} the addresses that open the remote on another device; empty
	 * 	without `--lan`
	 */
	fetchConnectLinks() {
		return this.#api.fetchConnectLinks();
	}

	/** @returns {Promise<import('./ports.js').AppInfo>} the versions of the app, yt-dlp and ffmpeg (DESIGN.md §9.17) */
	fetchInfo() {
		return this.#api.fetchInfo();
	}

	/**
	 * Allows or denies a device that asked to be paired. The list changes when the server says so.
	 * @param {string} address
	 * @param {'allow' | 'deny'} decision
	 */
	answerAccessRequest(address, decision) {
		this.#api.answerAccessRequest(address, decision).catch((error) => this.#logger.warn('Could not answer the connection request.', error));
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

	/** @returns {DownloadTools} the versions of yt-dlp and ffmpeg the server found, null for a missing one */
	getDownloadTools() {
		return { ...this.#downloadTools };
	}

	/** @returns {{ job: DownloadJob, log: string[] } | null} the server's download, running or finished, with its log */
	getDownload() {
		const job = this.#download;
		return job && {
			job: { ...job, target: { ...job.target }, items: job.items.map((item) => ({ ...item })) },
			log: [...this.#downloadLog],
		};
	}

	/**
	 * Asks the server what a link holds, so the user can choose what to download (DESIGN.md §5.4). Rejects with a
	 * message for the user when the link can't be used.
	 * @param {string} url
	 * @param {{ playlist?: boolean }} [options] look a link that names a video and a playlist up as the playlist
	 * @returns {Promise<import('./ports.js').LinkProbe>}
	 */
	probeLink(url, { playlist = false } = {}) {
		return this.#api.probeLink(url, { playlist });
	}

	/**
	 * Has the server download what a lookup found. Progress arrives as `download.changed` and `download.log`, and every
	 * file added as `sound.added`, `playlist.added` or `playlist.changed`.
	 * @param {import('./ports.js').DownloadRequest} request
	 * @returns {Promise<void>} rejects with a message for the user when the download can't start
	 */
	async startDownload(request) {
		const job = await this.#api.startDownload(request);
		// The event stream may have announced it first; then the log has already begun.
		if (job.id !== this.#download?.id) {
			this.#setDownload(job, null);
		}
	}

	/** Stops the running download; files it already added stay. */
	cancelDownload() {
		this.dismissDownload();
	}

	/** Cancels the running download, or forgets a finished one so its dialog closes. */
	dismissDownload() {
		this.#api.dismissDownload().catch((error) => this.#logger.error('Could not cancel or close the download', error));
	}

	/**
	 * Moves a sound into the server's trash (DESIGN.md §2.5). It stops at once, in every tab.
	 * @param {string} soundId
	 * @returns {Promise<void>} rejects with a message for the user
	 */
	deleteSound(soundId) {
		return this.#rearrange(() => this.#api.deleteItem({ kind: 'sound', id: soundId }));
	}

	/**
	 * Moves a track into the trash. A playlist's only track takes the playlist with it.
	 * @param {string} trackId
	 * @returns {Promise<void>} rejects with a message for the user
	 */
	deleteTrack(trackId) {
		return this.#rearrange(() => this.#api.deleteItem({ kind: 'track', id: trackId }));
	}

	/**
	 * Moves a playlist, with all its tracks, into the trash.
	 * @param {string} playlistId
	 * @returns {Promise<void>} rejects with a message for the user
	 */
	deletePlaylist(playlistId) {
		return this.#rearrange(() => this.#api.deleteItem({ kind: 'playlist', id: playlistId }));
	}

	/**
	 * Makes a sound a track of a playlist.
	 * @param {string} soundId
	 * @param {string} playlistId
	 * @returns {Promise<void>} rejects with a message for the user
	 */
	moveSound(soundId, playlistId) {
		return this.#rearrange(() => this.#api.moveItem(soundId, playlistId));
	}

	/**
	 * Moves a track into another playlist, or out to the sounds. A playlist's only track takes the playlist with it.
	 * @param {string} trackId
	 * @param {string | null} playlistId null for the sounds
	 * @returns {Promise<void>} rejects with a message for the user
	 */
	moveTrack(trackId, playlistId) {
		return this.#rearrange(() => this.#api.moveItem(trackId, playlistId));
	}

	/**
	 * Saves everything pending first, so no save can land on a file after it moved, then applies what the server did.
	 * The event stream brings the same changes, to this tab too, and those already applied are skipped.
	 * @param {() => Promise<import('./ports.js').LibraryChangeMessage[]>} request
	 */
	async #rearrange(request) {
		await this.#optionsSync.settleAll();
		for (const message of await request()) {
			this.#onServerMessage(message);
		}
	}

	/** What the server's trash holds, in short; `trash.changed` announces every change of it. */
	trashSummary() {
		return this.#trash;
	}

	/**
	 * @returns {Promise<import('./ports.js').TrashListing>} everything in the trash; rejects with a message for the user
	 */
	loadTrash() {
		return this.#api.fetchTrash();
	}

	/**
	 * Restores an item from the trash, or everything in it (DESIGN.md §2.5). What comes back appears as additions do.
	 * @param {import('./ports.js').TrashTarget} target
	 * @returns {Promise<void>} rejects with a message for the user
	 */
	restoreFromTrash(target) {
		return this.#rearrange(() => this.#api.restoreFromTrash(target));
	}

	/**
	 * Deletes an item in the trash for good, or everything in it.
	 * @param {import('./ports.js').TrashTarget} target
	 * @returns {Promise<void>} rejects with a message for the user
	 */
	deleteFromTrash(target) {
		return this.#api.deleteFromTrash(target);
	}

	/** @returns {boolean} whether a playlist is playing or paused, or any sound has a live instance */
	isAnythingPlaying() {
		return this.#activeOrder.length > 0 || (this.#loaded?.sounds.hasActive() ?? false);
	}

	/** @param {string} soundId */
	isSoundActive(soundId) {
		return this.#loaded?.sounds.isActive(soundId) ?? false;
	}

	async #load() {
		try {
			const [libraryJson, settings, download] = await Promise.all([
				this.#api.fetchLibrary(),
				this.#api.fetchSettings(),
				// Downloads are an extra; the board works without knowing about them.
				this.#api.fetchDownload().catch((error) => {
					this.#logger.warn('Could not ask the server about downloads.', error);
					return null;
				}),
			]);
			const library = new LibraryModel(libraryJson, (format) => this.#engine.canPlay(format));
			const isPlayable = (/** @type {import('./ports.js').AudioFileJson} */ file) => library.isPlayable(file);
			const emit = (/** @type {SoundboardEvent} */ event) => this.#events.emit(event);

			this.#volume.applyAll(settings.volumes);
			if (download) {
				this.#downloadTools = download.tools;
				this.#setDownload(download.job, download.job?.log ?? []);
			}
			const cache = new BufferCache({ load: (url) => this.#engine.loadBuffer(url) });
			const sounds = new SoundPlayer({ engine: this.#engine, clock: this.#clock, cache, emit, isPlayable });
			const playlists = new Map(libraryJson.playlists.map((playlist) => [playlist.id, this.#createPlayer(playlist, isPlayable)]));

			this.#loaded = { library, sounds, cache, playlists };
			const urls = this.#urls;
			for (const file of [...libraryJson.sounds, ...libraryJson.playlists.flatMap((playlist) => playlist.tracks)]) {
				urls.set(file.id, file.url);
			}
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
			this.#serverEvents?.connect((message) => this.#onServerMessage(message), { page: this.#pageId });
		} catch (error) {
			this.#starting = null;
			const message = error instanceof Error ? error.message : String(error);
			this.#logger.error('Could not start the soundboard', error);
			this.#events.emit({ type: 'app.startFailed', message });
		}
	}

	/**
	 * @param {PlaylistJson} playlist
	 * @param {(file: AudioFileJson) => boolean} isPlayable
	 */
	#createPlayer(playlist, isPlayable) {
		return new PlaylistPlayer({
			playlist,
			engine: this.#engine,
			clock: this.#clock,
			emit: (event) => this.#onPlaylistEvent(event),
			isPlayable,
			random: this.#random,
		});
	}

	/** @param {import('./ports.js').ServerMessage} message */
	#onServerMessage(message) {
		switch (message.type) {
			case 'remote.role':
				this.#onRole(message);
				return;
			case 'command':
				this.#onRemoteCommand(message.command);
				return;
			case 'externalChanges':
				this.#setExternalChanges(message.pending);
				return;
			case 'download':
				this.#setDownload(message.job, message.log ?? null);
				return;
			case 'download.log':
				this.#appendDownloadLog(message.lines, message.replaceLast);
				return;
			case 'library.added':
				this.#onAdded(message);
				return;
			case 'library.removed':
				this.#onRemoved(message);
				return;
			case 'problems':
				if (this.#problems.setServer(message.problems)) {
					this.#announceProblems();
				}
				return;
			case 'access.requests':
				this.#accessRequests = message.requests;
				this.#events.emit({ type: 'access.requestsChanged', requests: message.requests });
				return;
			case 'trash': {
				const { size, count } = message;
				if (size !== this.#trash.size || count !== this.#trash.count) {
					this.#trash = { size, count };
					this.#events.emit({ type: 'trash.changed', size, count });
				}
				return;
			}
		}
	}

	/**
	 * A sound, a track or a playlist was deleted or moved away. Whatever plays it stops at once. Like additions, these
	 * repeat in every tab, so anything already gone is skipped.
	 * @param {Extract<import('./ports.js').ServerMessage, { type: 'library.removed' }>} message
	 */
	#onRemoved(message) {
		const loaded = this.#loaded;
		if (!loaded) {
			return;
		}
		const { library } = loaded;
		if ('soundId' in message) {
			if (!library.hasSound(message.soundId)) {
				return;
			}
			loaded.sounds.stop(message.soundId);
			this.#forgetFile(message.soundId);
			library.removeSound(message.soundId);
			this.#events.emit({ type: 'sound.removed', soundId: message.soundId });
		} else if ('trackId' in message) {
			const playlist = library.hasPlaylist(message.playlistId) ? library.removeTrack(message.playlistId, message.trackId) : null;
			if (!playlist) {
				return;
			}
			this.#forgetFile(message.trackId);
			loaded.playlists.get(playlist.id)?.replaceTracks(playlist);
			this.#events.emit({ type: 'playlist.changed', playlist });
		} else {
			if (!library.hasPlaylist(message.playlistId)) {
				return;
			}
			loaded.playlists.get(message.playlistId)?.stop('instant');
			loaded.playlists.delete(message.playlistId);
			for (const track of library.playlist(message.playlistId).tracks) {
				this.#forgetFile(track.id);
			}
			library.removePlaylist(message.playlistId);
			this.#events.emit({ type: 'playlist.removed', playlistId: message.playlistId });
		}
	}

	/**
	 * Drops what is cached for a file that is gone, since a new file may later take its id and URL.
	 * @param {string} id
	 */
	#forgetFile(id) {
		const url = this.#urls.get(id);
		if (url !== undefined) {
			this.#loaded?.cache.forget(url);
		}
		this.#urls.delete(id);
		this.#waveforms?.forget(id);
	}

	/**
	 * Follows the server's download. The log starts afresh with every new job; `log` replaces it, as when the stream
	 * (re)connects.
	 * @param {DownloadJob | null} job
	 * @param {string[] | null} log
	 */
	#setDownload(job, log) {
		const isNew = job?.id !== this.#download?.id;
		if (job) {
			// The job from `fetchDownload` carries its log, which is kept apart.
			/** @type {DownloadJob & { log?: string[] }} */
			const copy = { ...job };
			delete copy.log;
			this.#download = copy;
		} else {
			this.#download = null;
		}
		if (log !== null || isNew) {
			this.#downloadLog = log ? [...log] : [];
		}
		this.#events.emit({ type: 'download.changed', job: this.#download, logReset: log !== null || isNew });
	}

	/**
	 * @param {string[]} lines
	 * @param {boolean} replaceLast the first line replaces the last one
	 */
	#appendDownloadLog(lines, replaceLast) {
		if (replaceLast && this.#downloadLog.length > 0) {
			this.#downloadLog.pop();
		}
		this.#downloadLog.push(...lines);
		if (this.#downloadLog.length > MAX_DOWNLOAD_LOG) {
			this.#downloadLog.splice(0, this.#downloadLog.length - MAX_DOWNLOAD_LOG);
		}
		this.#events.emit({ type: 'download.log', lines, replaceLast });
	}

	/**
	 * A download added a sound, a playlist or tracks to one. Messages repeat in every tab and after reconnecting, so
	 * whatever is already known is skipped.
	 * @param {Extract<import('./ports.js').ServerMessage, { type: 'library.added' }>} message
	 */
	#onAdded(message) {
		const loaded = this.#loaded;
		if (!loaded) {
			return;
		}
		const { library } = loaded;
		if ('sound' in message) {
			if (library.hasSound(message.sound.id)) {
				return;
			}
			library.addSound(message.sound);
			this.#urls.set(message.sound.id, message.sound.url);
			this.#events.emit({ type: 'sound.added', sound: message.sound });
		} else {
			const fromServer = message.playlist;
			for (const track of fromServer.tracks) {
				this.#urls.set(track.id, track.url);
			}
			if (!library.hasPlaylist(fromServer.id)) {
				library.addPlaylist(fromServer);
				loaded.playlists.set(fromServer.id, this.#createPlayer(fromServer, (file) => library.isPlayable(file)));
				this.#events.emit({ type: 'playlist.added', playlist: fromServer });
			} else {
				const before = library.playlist(fromServer.id).tracks.length;
				const playlist = library.addTracks(fromServer);
				if (playlist.tracks.length === before) {
					return;
				}
				loaded.playlists.get(playlist.id)?.replaceTracks(playlist);
				this.#events.emit({ type: 'playlist.changed', playlist });
			}
		}
		// Asks the server afresh, so the new files get their waveforms too.
		this.#waveforms?.start();
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

/**
 * @param {number} level
 * @returns {number} the level inside 0..1
 */
function clampLevel(level) {
	if (Number.isNaN(level)) {
		throw new InvalidCommandError('A level must be a number');
	}
	return Math.min(1, Math.max(0, level));
}
