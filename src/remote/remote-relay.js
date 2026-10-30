/**
 * What a remote may ask for. Customizing, volumes and everything else that changes something stay on the host's page
 * (DESIGN.md §5.2).
 */
const RELAYABLE_COMMANDS = new Set([
	'panic.stop',
	'sound.play',
	'sound.stop',
	'playlist.stop',
	'playlist.toggle',
	'playlist.pause',
	'playlist.resume',
	'playlist.next',
	'playlist.previous',
]);

/** How long a host's stream may stay closed before the page stops being the host. A reconnect within it keeps the role. */
export const HOST_GRACE_MS = 10_000;

/** A remote sent something that is not one of the commands it may send. */
export class NotRelayableError extends Error {
	constructor() {
		super('A remote cannot send this command');
		this.name = 'NotRelayableError';
	}
}

/** A command was sent while no page is hosting. */
export class NoHostError extends Error {
	constructor() {
		super('No host is connected');
		this.name = 'NoHostError';
	}
}

/** A page asked to become the host while another one is, and did not say it may replace it. */
export class HostTakenError extends Error {
	constructor() {
		super('Another page is the host');
		this.name = 'HostTakenError';
	}
}

/** A page that has no open event stream asked for the host role. The relay could not tell it what happens to it. */
export class UnknownPageError extends Error {
	constructor() {
		super('The page has no open event stream');
		this.name = 'UnknownPageError';
	}
}

/** @typedef {(message: object) => void} Send */
/** @typedef {{ setTimeout: (callback: () => void, milliseconds: number) => unknown, clearTimeout: (handle: any) => void }} Timers */

/** @type {Timers} */
const REAL_TIMERS = {
	// The grace period must not keep the process from exiting.
	setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds).unref(),
	clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Connects the remotes to the page that plays (DESIGN.md §5). The server still knows nothing about playback: it keeps the
 * latest state the host reported, in memory, and hands commands on without looking at what they mean.
 *
 * Any number of remotes and of ordinary pages can be attached, but at most one page is the host. A page becomes the host
 * only by asking, and replaces another host only when it says so. Nobody inherits the role: when the host stops hosting,
 * or its stream stays closed for longer than the grace period, it is free for whichever page asks next.
 */
export class RemoteRelay {
	/** @type {Timers} */
	#timers;
	/** @type {Map<string, Send>} the event streams of the pages (not remotes), by page id */
	#pages = new Map();
	/** @type {string | null} */
	#host = null;
	/** @type {unknown} the timer that ends the host's role after its stream closed */
	#graceTimer = null;
	/** @type {Set<Send>} */
	#remotes = new Set();
	/** @type {object | null} */
	#state = null;

	/** @param {{ timers?: Timers }} [options] */
	constructor({ timers = REAL_TIMERS } = {}) {
		this.#timers = timers;
	}

	/** @returns {boolean} whether a page is the host */
	get hasHost() {
		return this.#host !== null;
	}

	/**
	 * Registers the event stream of a page that plays (not of a remote). Each page tells whether it is the host
	 * (`remote.role`), so a page that missed its replacement while it was disconnected finds out.
	 * @param {string} pageId chosen by the page, the same for every stream it opens
	 * @param {Send} send delivers a message to the stream
	 * @returns {() => void} detaches the stream
	 */
	attachPage(pageId, send) {
		this.#pages.set(pageId, send);
		if (this.#host === pageId) {
			this.#timers.clearTimeout(this.#graceTimer);
			this.#graceTimer = null;
		}
		send({ type: 'remote.role', host: this.#host === pageId });
		return () => {
			if (this.#pages.get(pageId) !== send) {
				return;
			}
			this.#pages.delete(pageId);
			if (this.#host === pageId) {
				this.#graceTimer = this.#timers.setTimeout(() => this.#release(), HOST_GRACE_MS);
			}
		};
	}

	/**
	 * Makes a page the host.
	 * @param {string} pageId an attached page
	 * @param {{ replace?: boolean }} [options] `replace` takes the role from another host, which is told
	 * @throws {UnknownPageError} when the page has no open stream
	 * @throws {HostTakenError} when another page is the host and `replace` is not set
	 */
	claimHost(pageId, { replace = false } = {}) {
		if (!this.#pages.has(pageId)) {
			throw new UnknownPageError();
		}
		if (this.#host === pageId) {
			return;
		}
		if (this.#host !== null && !replace) {
			throw new HostTakenError();
		}
		const previous = this.#host;
		if (previous !== null) {
			this.#release();
			this.#pages.get(previous)?.({ type: 'remote.role', host: false, reason: 'replaced' });
		}
		this.#host = pageId;
		this.#broadcast({ type: 'remote.host', connected: true });
	}

	/**
	 * @param {string} pageId
	 * @returns {boolean} whether it was the host
	 */
	releaseHost(pageId) {
		if (this.#host !== pageId) {
			return false;
		}
		this.#release();
		return true;
	}

	/**
	 * @param {Send} send delivers a message to the remote's event stream; it gets the current host and state first
	 * @returns {() => void} detaches it
	 */
	attachRemote(send) {
		this.#remotes.add(send);
		send({ type: 'remote.host', connected: this.#host !== null });
		if (this.#state) {
			send({ type: 'remote.state', state: this.#state });
		}
		return () => this.#remotes.delete(send);
	}

	/**
	 * @param {string} pageId
	 * @param {object} state
	 * @returns {boolean} `false` when that page is not the host, and its state was ignored
	 */
	updateState(pageId, state) {
		if (this.#host !== pageId) {
			return false;
		}
		this.#state = state;
		this.#broadcast({ type: 'remote.state', state });
		return true;
	}

	/**
	 * Passes a command to the host. The host checks that it is well-formed and that its ids exist.
	 * @param {unknown} command
	 * @throws {NotRelayableError} for anything a remote may not send
	 * @throws {NoHostError} when no page is hosting, or the host's stream is closed for the moment
	 */
	sendCommand(command) {
		if (
			typeof command !== 'object'
			|| command === null
			|| !('type' in command)
			|| typeof command.type !== 'string'
			|| !RELAYABLE_COMMANDS.has(command.type)
		) {
			throw new NotRelayableError();
		}
		const send = this.#host === null ? undefined : this.#pages.get(this.#host);
		if (!send) {
			throw new NoHostError();
		}
		send({ type: 'command', command });
	}

	#release() {
		this.#timers.clearTimeout(this.#graceTimer);
		this.#graceTimer = null;
		if (this.#host === null) {
			return;
		}
		this.#host = null;
		this.#state = null;
		this.#broadcast({ type: 'remote.host', connected: false });
		this.#broadcast({ type: 'remote.state', state: null });
	}

	/** @param {object} message */
	#broadcast(message) {
		for (const send of this.#remotes) {
			send(message);
		}
	}
}
