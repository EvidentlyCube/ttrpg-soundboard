import { randomUUID } from 'node:crypto';

/**
 * What a remote may ask for. Customizing, volumes and everything else that changes something stay on the host's page
 * (DESIGN.md §5.2).
 */
const RELAYABLE_COMMANDS = new Set([
	'panic.stop',
	'sound.play',
	'playlist.toggle',
	'playlist.pause',
	'playlist.resume',
	'playlist.next',
	'playlist.previous',
]);

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

/** @typedef {(message: object) => void} Send */

/**
 * Connects the remotes to the page that plays (DESIGN.md §5). The server still knows nothing about playback: it keeps the
 * latest state the host reported, in memory, and hands commands on without looking at what they mean.
 *
 * Any number of remotes can attach, but only one host, the first. A page that starts as host later is not controlled
 * by the remotes and never takes the role over, so sound cannot suddenly start coming from another device. When the host
 * goes away the role is free again, and it goes to the next page that asks for it, not to one that already asked.
 */
export class RemoteRelay {
	/** @type {{ id: string, send: Send } | null} */
	#host = null;
	/** @type {Set<Send>} */
	#remotes = new Set();
	/** @type {object | null} */
	#state = null;

	/**
	 * @param {Send} send delivers a message to the host's event stream
	 * @returns {{ id: string, detach: () => void } | null} `id` goes with the host's state (`updateState`); `null` when
	 * another page is the host
	 */
	attachHost(send) {
		if (this.#host) {
			return null;
		}
		const host = { id: randomUUID(), send };
		this.#host = host;
		this.#broadcast({ type: 'remote.host', connected: true });
		return {
			id: host.id,
			detach: () => {
				if (this.#host !== host) {
					return;
				}
				this.#host = null;
				this.#state = null;
				this.#broadcast({ type: 'remote.host', connected: false });
				this.#broadcast({ type: 'remote.state', state: null });
			},
		};
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
	 * @param {string} hostId from `attachHost`
	 * @param {object} state
	 * @returns {boolean} `false` when that page is not the host any more, and its state was ignored
	 */
	updateState(hostId, state) {
		if (this.#host?.id !== hostId) {
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
	 * @throws {NoHostError} when no page is hosting
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
		if (!this.#host) {
			throw new NoHostError();
		}
		this.#host.send({ type: 'command', command });
	}

	/** @param {object} message */
	#broadcast(message) {
		for (const send of this.#remotes) {
			send(message);
		}
	}
}
