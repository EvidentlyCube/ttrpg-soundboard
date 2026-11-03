import { EventEmitter } from './event-emitter.js';

/** @typedef {import('./ports.js').BackendApi} BackendApi */
/** @typedef {import('./ports.js').Logger} Logger */
/** @typedef {import('./ports.js').ServerEvents} ServerEvents */
/** @typedef {import('./remote-state.js').RemoteState} RemoteState */
/** @typedef {import('./transitions.js').Transition} Transition */

/**
 * @typedef {{ type: 'remote.hostChanged', connected: boolean }
 * 	| { type: 'remote.stateChanged', state: RemoteState | null }
 * 	| { type: 'panic.changed', state: 'fade' | 'now' }
 * 	| { type: 'remote.closed' }} RemoteEvent
 * `panic.changed` is the same event the soundboard announces, so the Panic Stop button works with either.
 * `remote.closed`: the soundboard was closed on the server, which forgot this device (DESIGN.md §1.1).
 */

/**
 * The page's side of a remote control (DESIGN.md §6.10). It plays nothing: it shows the state the host reports and sends
 * the few commands a remote may send, which the host runs. It never touches the audio.
 */
export class RemoteController {
	#api;
	#serverEvents;
	#logger;
	/** @type {EventEmitter<RemoteEvent>} */
	#events;
	#connected = false;
	/** @type {RemoteState | null} */
	#state = null;
	/** @type {(() => void) | null} */
	#disconnect = null;

	/**
	 * @param {object} ports
	 * @param {BackendApi} ports.api
	 * @param {ServerEvents} ports.serverEvents
	 * @param {Logger} ports.logger
	 */
	constructor({ api, serverEvents, logger }) {
		this.#api = api;
		this.#serverEvents = serverEvents;
		this.#logger = logger;
		this.#events = new EventEmitter((error, event) => logger.error(`A handler for ${event.type} failed`, error));
	}

	/**
	 * Whether a page is the host right now, for the splash. Resolves `null` when the server can't say.
	 * @returns {Promise<boolean | null>}
	 */
	async checkHost() {
		try {
			return await this.#api.fetchHostStatus();
		} catch (error) {
			this.#logger.warn('Could not ask the server whether a page is the host.', error);
			return null;
		}
	}

	/** Starts following the host. The server sends the current host and state first. */
	start() {
		this.#disconnect ??= this.#serverEvents.connect((message) => {
			if (message.type === 'remote.host') {
				this.#setConnected(message.connected);
			} else if (message.type === 'remote.state') {
				this.#setState(message.state);
			} else if (message.type === 'startup.closed') {
				this.stop();
				this.#events.emit({ type: 'remote.closed' });
			}
		}, { role: 'remote' });
	}

	stop() {
		this.#disconnect?.();
		this.#disconnect = null;
	}

	/**
	 * @template {RemoteEvent['type']} T
	 * @param {T} type
	 * @param {(event: Extract<RemoteEvent, { type: T }>) => void} handler
	 * @returns {() => void} unsubscribes
	 */
	on(type, handler) {
		return this.#events.on(type, handler);
	}

	/** @returns {boolean} whether a page is the host */
	hostConnected() {
		return this.#connected;
	}

	/** @returns {RemoteState | null} null while there is no host, or it has not reported yet */
	state() {
		return this.#state;
	}

	/** @returns {'fade' | 'now'} what the next press of Panic Stop does */
	panicState() {
		return this.#state?.panic ?? 'fade';
	}

	panicStop() {
		this.#send({ type: 'panic.stop' });
	}

	/** @param {string} soundId */
	playSound(soundId) {
		this.#send({ type: 'sound.play', soundId });
	}

	/** @param {string} playlistId */
	togglePlaylist(playlistId) {
		this.#send({ type: 'playlist.toggle', playlistId });
	}

	/** @param {string} soundId */
	stopSound(soundId) {
		this.#send({ type: 'sound.stop', soundId });
	}

	/** @param {string} playlistId */
	stopPlaylist(playlistId) {
		this.#send({ type: 'playlist.stop', playlistId });
	}

	/** @param {string} playlistId */
	pausePlaylist(playlistId) {
		this.#send({ type: 'playlist.pause', playlistId });
	}

	/** @param {string} playlistId */
	resumePlaylist(playlistId) {
		this.#send({ type: 'playlist.resume', playlistId });
	}

	/** @param {string} playlistId */
	nextTrack(playlistId) {
		this.#send({ type: 'playlist.next', playlistId });
	}

	/** @param {string} playlistId */
	previousTrack(playlistId) {
		this.#send({ type: 'playlist.previous', playlistId });
	}

	/** @param {import('./commands.js').Command} command */
	#send(command) {
		// The state that follows shows whether it worked; a failure here (the host just left) is only worth a log line.
		this.#api.sendRemoteCommand(command).catch((error) => this.#logger.warn('The host did not get a command.', error));
	}

	/** @param {boolean} connected */
	#setConnected(connected) {
		if (connected === this.#connected) {
			return;
		}
		this.#connected = connected;
		this.#events.emit({ type: 'remote.hostChanged', connected });
	}

	/** @param {RemoteState | null} state */
	#setState(state) {
		const panic = this.panicState();
		this.#state = state;
		this.#events.emit({ type: 'remote.stateChanged', state });
		if (this.panicState() !== panic) {
			this.#events.emit({ type: 'panic.changed', state: this.panicState() });
		}
	}
}
