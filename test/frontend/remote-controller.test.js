import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteController } from '../../public/app/logic/remote-controller.js';
import { FakeBackendApi, NO_BACKGROUND } from '../helpers/fake-backend-api.js';

/** @typedef {import('../../public/app/logic/ports.js').ServerMessage} ServerMessage */

/** @type {import('../../public/app/logic/remote-state.js').RemoteState} */
const STATE = {
	panic: 'fade',
	playlists: [{ id: 'Combat', title: 'Combat', playable: true, ...NO_BACKGROUND }],
	sounds: [{ id: 'Boom.mp3', title: 'Boom', playable: true }],
	players: [{ id: 'Combat', title: 'Combat', state: 'playing', trackTitle: 'Battle' }],
	activeSounds: [],
};

function setup() {
	const api = new FakeBackendApi();
	/** @type {((message: ServerMessage) => void) | null} */
	let onMessage = null;
	/** @type {Record<string, string> | undefined} */
	let params;
	let disconnects = 0;
	const serverEvents = {
		connect: (/** @type {(message: ServerMessage) => void} */ handler, /** @type {Record<string, string> | undefined} */ given) => {
			onMessage = handler;
			params = given;
			return () => {
				disconnects++;
			};
		},
	};
	/** @type {unknown[][]} */
	const logged = [];
	const logger = { warn: (/** @type {unknown[]} */ ...args) => logged.push(args), error: (/** @type {unknown[]} */ ...args) => logged.push(args) };
	const remote = new RemoteController({ api, serverEvents, logger });
	/** @type {import('../../public/app/logic/remote-controller.js').RemoteEvent[]} */
	const events = [];
	for (const type of /** @type {const} */ (['remote.hostChanged', 'remote.stateChanged', 'panic.changed'])) {
		remote.on(type, (event) => events.push(event));
	}
	return {
		api, remote, events, logged,
		send: (/** @type {ServerMessage} */ message) => onMessage?.(message),
		params: () => params,
		disconnects: () => disconnects,
	};
}

describe('RemoteController', () => {
	it("asks the server whether a page is the host, and says nothing when it can't tell", async () => {
		const { api, remote, logged } = setup();
		assert.equal(await remote.checkHost(), false);
		api.hostPresent = true;
		assert.equal(await remote.checkHost(), true);
		api.fetchHostStatus = async () => {
			throw new Error('down');
		};
		assert.equal(await remote.checkHost(), null);
		assert.equal(logged.length, 1);
	});

	it('follows the host through the stream of a remote', () => {
		const { remote, send, params, events } = setup();
		assert.equal(remote.hostConnected(), false);
		assert.equal(remote.state(), null);
		remote.start();
		assert.deepEqual(params(), { role: 'remote' });
		send({ type: 'remote.host', connected: true });
		send({ type: 'remote.state', state: STATE });
		assert.equal(remote.hostConnected(), true);
		assert.deepEqual(remote.state(), STATE);
		assert.deepEqual(events.map((event) => event.type), ['remote.hostChanged', 'remote.stateChanged']);
	});

	it('announces a host change only when it is one', () => {
		const { remote, send, events } = setup();
		remote.start();
		send({ type: 'remote.host', connected: false });
		send({ type: 'remote.host', connected: true });
		send({ type: 'remote.host', connected: true });
		assert.equal(events.length, 1);
	});

	it('forgets the state when the host goes', () => {
		const { remote, send } = setup();
		remote.start();
		send({ type: 'remote.state', state: STATE });
		send({ type: 'remote.state', state: null });
		assert.equal(remote.state(), null);
	});

	it('announces Panic Stop changes like the soundboard does', () => {
		const { remote, send, events } = setup();
		remote.start();
		send({ type: 'remote.state', state: STATE });
		assert.equal(remote.panicState(), 'fade');
		send({ type: 'remote.state', state: { ...STATE, panic: 'now' } });
		assert.equal(remote.panicState(), 'now');
		send({ type: 'remote.state', state: null });
		assert.deepEqual(events.filter((event) => event.type === 'panic.changed'), [
			{ type: 'panic.changed', state: 'now' },
			{ type: 'panic.changed', state: 'fade' },
		]);
	});

	it('connects once, and disconnects when stopped', () => {
		const { remote, disconnects } = setup();
		remote.start();
		remote.start();
		remote.stop();
		remote.stop();
		assert.equal(disconnects(), 1);
	});

	it('sends the commands a remote may send', async () => {
		const { remote, api } = setup();
		remote.panicStop();
		remote.playSound('Boom.mp3');
		remote.togglePlaylist('Combat');
		remote.pausePlaylist('Combat');
		remote.resumePlaylist('Combat');
		remote.nextTrack('Combat');
		remote.previousTrack('Combat');
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(api.remoteCommands, [
			{ type: 'panic.stop' },
			{ type: 'sound.play', soundId: 'Boom.mp3' },
			{ type: 'playlist.toggle', playlistId: 'Combat' },
			{ type: 'playlist.pause', playlistId: 'Combat' },
			{ type: 'playlist.resume', playlistId: 'Combat' },
			{ type: 'playlist.next', playlistId: 'Combat' },
			{ type: 'playlist.previous', playlistId: 'Combat' },
		]);
	});

	it('only logs a command the host did not get', async () => {
		const { remote, api, logged } = setup();
		api.remoteCommandError = new Error('No host is connected');
		remote.panicStop();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(logged.length, 1);
	});
});
