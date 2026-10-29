import { randomUUID } from 'node:crypto';

/**
 * What a remote may ask for. Customizing, volumes and everything else that changes something stay on the player's page
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

/** A command was sent while no page is playing. */
export class NoPlayerError extends Error {
	constructor() {
		super('No player is connected');
		this.name = 'NoPlayerError';
	}
}

/** @typedef {(message: object) => void} Send */

/**
 * Connects the remotes to the page that plays (DESIGN.md §5). The server still knows nothing about playback: it keeps the
 * latest state the host reported, in memory, and hands commands on without looking at what they mean.
 *
 * Any number of remotes and players can be attached. The most recently attached player is the host: it gets the
 * commands, and only its state is kept. When it goes away, the one before it takes over.
 */
export class RemoteRelay {
	/** @type {{ id: string, send: Send }[]} oldest first */
	#players = [];
	/** @type {Set<Send>} */
	#remotes = new Set();
	/** @type {object | null} */
	#state = null;

	/**
	 * @param {Send} send delivers a message to the player's event stream
	 * @returns {{ id: string, detach: () => void }} `id` goes with the player's state (`updateState`)
	 */
	attachPlayer(send) {
		const player = { id: randomUUID(), send };
		this.#players.push(player);
		this.#hostChanged();
		return {
			id: player.id,
			detach: () => {
				const index = this.#players.indexOf(player);
				if (index === -1) {
					return;
				}
				const wasHost = index === this.#players.length - 1;
				this.#players.splice(index, 1);
				if (wasHost) {
					this.#hostChanged();
				}
			},
		};
	}

	/**
	 * @param {Send} send delivers a message to the remote's event stream; it gets the current host and state first
	 * @returns {() => void} detaches it
	 */
	attachRemote(send) {
		this.#remotes.add(send);
		send({ type: 'remote.player', connected: this.#host !== undefined });
		if (this.#state) {
			send({ type: 'remote.state', state: this.#state });
		}
		return () => this.#remotes.delete(send);
	}

	/**
	 * @param {string} playerId from `attachPlayer`
	 * @param {object} state
	 * @returns {boolean} `false` when that player is not the host, and its state was ignored
	 */
	updateState(playerId, state) {
		if (this.#host?.id !== playerId) {
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
	 * @throws {NoPlayerError} when no player is connected
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
		const host = this.#host;
		if (!host) {
			throw new NoPlayerError();
		}
		host.send({ type: 'command', command });
	}

	get #host() {
		return this.#players.at(-1);
	}

	/** The old state belongs to the previous host, so it goes until the new one reports its own. */
	#hostChanged() {
		const host = this.#host;
		const hadState = this.#state !== null;
		this.#state = null;
		this.#broadcast({ type: 'remote.player', connected: host !== undefined });
		if (hadState) {
			this.#broadcast({ type: 'remote.state', state: null });
		}
		host?.send({ type: 'remote.host' });
	}

	/** @param {object} message */
	#broadcast(message) {
		for (const send of this.#remotes) {
			send(message);
		}
	}
}
