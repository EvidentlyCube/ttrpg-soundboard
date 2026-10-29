import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Soundboard } from '../../public/app/logic/soundboard.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeBackendApi } from '../helpers/fake-backend-api.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeWaveformDecoder } from '../helpers/fake-waveform-decoder.js';

/** @typedef {import('../../public/app/logic/ports.js').ServerMessage} ServerMessage */

/** Stands in for the server's pushed messages; `send` delivers one the way the stream would. */
class FakeServerEvents {
	/** @type {((message: ServerMessage) => void) | null} */
	#onMessage = null;
	/** @type {Record<string, string> | undefined} */
	params;

	/** @type {import('../../public/app/logic/ports.js').ServerEvents['connect']} */
	connect(onMessage, params) {
		this.#onMessage = onMessage;
		this.params = params;
		return () => {
			this.#onMessage = null;
		};
	}

	/** @param {ServerMessage} message */
	send(message) {
		this.#onMessage?.(message);
	}
}

/** @param {{ withStream?: boolean }} [options] */
async function started({ withStream = true } = {}) {
	const clock = new FakeClock();
	const engine = new FakeAudioEngine(clock, { defaultScript: { duration: 30, loadDelay: 0 } });
	const api = new FakeBackendApi();
	/** @type {unknown[][]} */
	const logged = [];
	const logger = { warn: (/** @type {unknown[]} */ ...args) => logged.push(args), error: (/** @type {unknown[]} */ ...args) => logged.push(args) };
	const serverEvents = new FakeServerEvents();
	const soundboard = new Soundboard({
		engine, clock, api, logger, decoder: new FakeWaveformDecoder(), pageId: 'page-1', serverEvents: withStream ? serverEvents : undefined,
	});
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	await soundboard.start();
	await settle();
	/** @param {number} milliseconds */
	const advance = async (milliseconds) => {
		clock.advance(milliseconds);
		await settle();
	};
	/** @type {{ type: string, [key: string]: unknown }[]} */
	const events = [];
	for (const type of /** @type {const} */ (['host.changed', 'problems.changed'])) {
		soundboard.on(type, (event) => events.push(event));
	}
	serverEvents.send({ type: 'remote.role', host: false });
	return { soundboard, api, clock, serverEvents, logged, settle, advance, events };
}

async function hosting() {
	const setup = await started();
	assert.equal(await setup.soundboard.becomeHost(), 'hosting');
	await setup.advance(0);
	setup.api.remoteStates.length = 0;
	return setup;
}

describe('becoming the host', () => {
	it('is standalone until asked, and tells the server which page its stream belongs to', async () => {
		const { soundboard, serverEvents, api } = await started();
		assert.equal(soundboard.isHosting(), false);
		assert.deepEqual(serverEvents.params, { page: 'page-1' });
		assert.deepEqual(api.claims, []);
	});

	it('claims the role without replacing anyone, and announces it', async () => {
		const { soundboard, api, events } = await started();
		assert.equal(await soundboard.becomeHost(), 'hosting');
		assert.deepEqual(api.claims, [{ pageId: 'page-1', replace: false }]);
		assert.equal(soundboard.isHosting(), true);
		assert.deepEqual(events.filter((event) => event.type === 'host.changed'), [{ type: 'host.changed', hosting: true }]);
	});

	it('reports that another page is the host, and stays standalone', async () => {
		const { soundboard, api, events } = await started();
		api.claimResult = 'taken';
		assert.equal(await soundboard.becomeHost(), 'taken');
		assert.equal(soundboard.isHosting(), false);
		assert.deepEqual(events, []);
		assert.deepEqual(soundboard.getProblems(), []);
	});

	it('replaces the other host when asked to', async () => {
		const { soundboard, api } = await started();
		api.claimResult = 'taken';
		await soundboard.becomeHost();
		api.claimResult = 'claimed';
		assert.equal(await soundboard.becomeHost({ replace: true }), 'hosting');
		assert.deepEqual(api.claims.at(-1), { pageId: 'page-1', replace: true });
	});

	it('stays standalone when the claim fails, and lists a warning', async () => {
		const { soundboard, api, events } = await started();
		api.claimResult = new Error('HTTP 500');
		assert.equal(await soundboard.becomeHost(), 'failed');
		assert.equal(soundboard.isHosting(), false);
		assert.deepEqual(soundboard.getProblems().map(({ kind, severity, message }) => ({ kind, severity, message })), [
			{ kind: 'host-failed', severity: 'warning', message: 'HTTP 500' },
		]);
		assert.equal(events.some((event) => event.type === 'problems.changed'), true);
	});

	it('removes the warning once it works', async () => {
		const { soundboard, api } = await started();
		api.claimResult = new Error('HTTP 500');
		await soundboard.becomeHost();
		api.claimResult = 'claimed';
		await soundboard.becomeHost();
		assert.deepEqual(soundboard.getProblems(), []);
	});

	/**
	 * A page whose stream has not said anything yet.
	 * @param {string} pageId
	 */
	async function startedWithoutRole(pageId) {
		const clock = new FakeClock();
		const api = new FakeBackendApi();
		const serverEvents = new FakeServerEvents();
		const soundboard = new Soundboard({
			engine: new FakeAudioEngine(clock), clock, api, logger: { warn() {}, error() {} },
			decoder: new FakeWaveformDecoder(), pageId, serverEvents,
		});
		await soundboard.start();
		await new Promise((resolve) => setImmediate(resolve));
		return { clock, api, serverEvents, soundboard };
	}

	it('waits for the page\'s stream to open before it claims', async () => {
		const { api, serverEvents, soundboard } = await startedWithoutRole('p');
		const result = soundboard.becomeHost();
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(api.claims, []);
		serverEvents.send({ type: 'remote.role', host: false });
		assert.equal(await result, 'hosting');
		assert.equal(api.claims.length, 1);
	});

	it('fails, with a warning, when the stream never opens', async () => {
		const { clock, soundboard } = await startedWithoutRole('q');
		const result = soundboard.becomeHost();
		clock.advance(5000);
		assert.equal(await result, 'failed');
		assert.equal(soundboard.getProblems()[0].kind, 'host-failed');
	});

	it('asks only once while a claim is under way', async () => {
		const { soundboard, api } = await started();
		const first = soundboard.becomeHost();
		const second = soundboard.becomeHost();
		await Promise.all([first, second]);
		assert.equal(api.claims.length, 1);
	});
});

describe('giving the role up', () => {
	it('releases it on request', async () => {
		const { soundboard, api, events } = await hosting();
		soundboard.stopHosting();
		assert.equal(soundboard.isHosting(), false);
		assert.deepEqual(api.releases, [{ pageId: 'page-1', keepalive: false }]);
		assert.deepEqual(events.filter((event) => event.type === 'host.changed').at(-1), { type: 'host.changed', hosting: false });
	});

	it('does nothing when it is not the host, and can release while the page closes', async () => {
		const { soundboard, api } = await started();
		soundboard.stopHosting();
		assert.deepEqual(api.releases, []);
		await soundboard.becomeHost();
		soundboard.stopHosting({ keepalive: true });
		assert.deepEqual(api.releases, [{ pageId: 'page-1', keepalive: true }]);
	});

	it('stops being the host, with an error in the problems list, when another page took over', async () => {
		const { soundboard, serverEvents, events } = await hosting();
		serverEvents.send({ type: 'remote.role', host: false, reason: 'replaced' });
		assert.equal(soundboard.isHosting(), false);
		assert.deepEqual(soundboard.getProblems().map(({ kind, severity, message }) => ({ kind, severity, message })), [
			{ kind: 'host-lost', severity: 'error', message: 'Another page took over as host.' },
		]);
		assert.deepEqual(events.filter((event) => event.type === 'host.changed').at(-1), { type: 'host.changed', hosting: false });
	});

	it('says the connection was lost when it learns of it on reconnecting', async () => {
		const { soundboard, serverEvents } = await hosting();
		serverEvents.send({ type: 'remote.role', host: false });
		assert.match(soundboard.getProblems()[0].message, /disconnected/);
	});

	it('keeps playing what it plays after losing the role', async () => {
		const { soundboard, serverEvents } = await hosting();
		soundboard.togglePlaylist('Combat');
		serverEvents.send({ type: 'remote.role', host: false, reason: 'replaced' });
		assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'loading');
	});

	it('can be dismissed like any other problem, and a new claim clears it', async () => {
		const { soundboard, serverEvents } = await hosting();
		serverEvents.send({ type: 'remote.role', host: false, reason: 'replaced' });
		const [problem] = soundboard.getProblems();
		soundboard.dismissProblem(problem.id);
		assert.deepEqual(soundboard.getProblems(), []);
		serverEvents.send({ type: 'remote.role', host: false, reason: 'replaced' });
		await soundboard.becomeHost();
		assert.deepEqual(soundboard.getProblems(), []);
	});
});

describe('being controlled', () => {
	it('runs the commands a remote sends', async () => {
		const { soundboard, serverEvents } = await hosting();
		serverEvents.send({ type: 'command', command: { type: 'playlist.toggle', playlistId: 'Combat' } });
		assert.notEqual(soundboard.getPlaylistSnapshot('Combat').state, 'idle');
		serverEvents.send({ type: 'command', command: { type: 'panic.stop' } });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'idle');
	});

	it('ignores commands while it is not the host', async () => {
		const { soundboard, serverEvents } = await started();
		serverEvents.send({ type: 'command', command: { type: 'playlist.toggle', playlistId: 'Combat' } });
		assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'idle');
	});

	it('only logs a command that fails', async () => {
		const { serverEvents, logged } = await hosting();
		serverEvents.send({ type: 'command', command: { type: 'playlist.toggle', playlistId: 'Nowhere' } });
		serverEvents.send({ type: 'command', command: { type: 'nonsense' } });
		assert.equal(logged.length, 2);
	});
});

describe('telling the remotes', () => {
	it('sends the board when it becomes the host', async () => {
		const { soundboard, api, advance } = await started();
		await soundboard.becomeHost();
		await advance(0);
		assert.equal(api.remoteStates.length, 1);
		const { pageId, state } = api.remoteStates[0];
		assert.equal(pageId, 'page-1');
		assert.deepEqual(state.playlists, [
			{ id: 'Combat', title: 'Combat', playable: true },
			{ id: 'Tavern', title: 'Tavern', playable: true },
		]);
		assert.deepEqual(state.sounds, [{ id: 'Boom.mp3', title: 'Boom', playable: true }, { id: 'Rain.ogg', title: 'Rain', playable: true }]);
		assert.deepEqual(state.players, []);
		assert.equal(state.panic, 'fade');
	});

	it('sends nothing while it is not the host', async () => {
		const { soundboard, api, advance } = await started();
		soundboard.togglePlaylist('Combat');
		await advance(0);
		assert.deepEqual(api.remoteStates, []);
	});

	it('sends the players in the order they started, with the track that plays', async () => {
		const { soundboard, api, advance } = await hosting();
		soundboard.togglePlaylist('Tavern');
		soundboard.togglePlaylist('Combat');
		await advance(0);
		const state = api.remoteStates.at(-1)?.state;
		assert.deepEqual(state?.players.map(({ id, state: playerState, trackTitle }) => ({ id, playerState, trackTitle })), [
			{ id: 'Tavern', playerState: 'playing', trackTitle: 'Song' },
			{ id: 'Combat', playerState: 'playing', trackTitle: 'Battle' },
		]);
		assert.equal(state?.players[0].title, 'Tavern');
	});

	it('sends one state for changes that come together', async () => {
		const { soundboard, api, advance } = await hosting();
		soundboard.customizePlaylist('Tavern', { title: 'Inn' });
		soundboard.customizePlaylist('Combat', { title: 'Fights' });
		soundboard.customizeSound('Boom.mp3', { title: 'Bang' });
		await advance(0);
		assert.equal(api.remoteStates.length, 1);
		assert.deepEqual(api.remoteStates[0].state.playlists.map((playlist) => playlist.title), ['Fights', 'Inn']);
	});

	it('shows a paused playlist, a track change and the sounds that play', async () => {
		const { soundboard, api, advance } = await hosting();
		soundboard.togglePlaylist('Combat');
		await advance(0);
		soundboard.pausePlaylist('Combat');
		await advance(0);
		assert.equal(api.remoteStates.at(-1)?.state.players[0].state, 'paused');
		soundboard.resumePlaylist('Combat');
		soundboard.nextTrack('Combat');
		await advance(0);
		assert.equal(api.remoteStates.at(-1)?.state.players[0].trackTitle, 'Boss');
		soundboard.playSound('Boom.mp3');
		await advance(0);
		await advance(0);
		assert.deepEqual(api.remoteStates.at(-1)?.state.activeSounds, ['Boom.mp3']);
		await advance(60_000);
		await advance(0);
		assert.deepEqual(api.remoteStates.at(-1)?.state.activeSounds, []);
	});

	it('follows Panic Stop and renamed titles', async () => {
		const { soundboard, api, advance } = await hosting();
		soundboard.customizePlaylist('Combat', { title: 'Fights' });
		await advance(0);
		assert.equal(api.remoteStates.at(-1)?.state.playlists[0].title, 'Fights');
		soundboard.playSound('Boom.mp3');
		soundboard.panicStop();
		await advance(0);
		assert.equal(api.remoteStates.at(-1)?.state.panic, 'fade');
	});

	it('sends one state at a time, and the latest once the one under way has arrived', async () => {
		const { soundboard, api, advance, settle } = await hosting();
		/** @type {() => void} */
		let release = () => {};
		api.remoteStateGate = new Promise((resolve) => {
			release = resolve;
		});
		soundboard.customizePlaylist('Combat', { title: 'One' });
		await advance(0);
		soundboard.customizePlaylist('Combat', { title: 'Two' });
		await advance(0);
		soundboard.customizePlaylist('Combat', { title: 'Three' });
		await advance(0);
		assert.equal(api.remoteStates.length, 1);
		api.remoteStateGate = null;
		release();
		await settle();
		assert.equal(api.remoteStates.length, 2);
		assert.equal(api.remoteStates[1].state.playlists.find((playlist) => playlist.id === 'Combat')?.title, 'Three');
	});

	it('sends the state again when its stream reconnects while it still is the host', async () => {
		const { serverEvents, api, advance } = await hosting();
		serverEvents.send({ type: 'remote.role', host: true });
		await advance(0);
		assert.equal(api.remoteStates.length, 1);
	});

	it('stops sending once it gave the role up', async () => {
		const { soundboard, api, advance } = await hosting();
		soundboard.stopHosting();
		soundboard.togglePlaylist('Combat');
		await advance(0);
		assert.deepEqual(api.remoteStates, []);
	});
});
