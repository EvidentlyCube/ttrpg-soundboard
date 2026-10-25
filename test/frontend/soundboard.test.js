import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCommandError, NotReadyError } from '../../public/app/logic/errors.js';
import { Soundboard } from '../../public/app/logic/soundboard.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeBackendApi } from '../helpers/fake-backend-api.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {import('../../public/app/logic/soundboard.js').SoundboardEvent} SoundboardEvent */

const EVENT_TYPES = /** @type {const} */ ([
	'app.ready', 'app.startFailed', 'audio.suspended', 'audio.resumed',
	'sound.activeChanged', 'sound.error',
	'playlist.stateChanged', 'playlist.progress', 'playlist.error',
	'volume.changed',
]);

/** @param {{ canPlay?: (format: 'mp3' | 'ogg') => boolean }} [options] */
function setup({ canPlay } = {}) {
	const clock = new FakeClock();
	const engine = new FakeAudioEngine(clock, { canPlay, defaultScript: { duration: 30, loadDelay: 0.1 } });
	const api = new FakeBackendApi();
	/** @type {unknown[][]} */
	const logged = [];
	const logger = { warn: (/** @type {unknown[]} */ ...args) => logged.push(args), error: (/** @type {unknown[]} */ ...args) => logged.push(args) };
	const soundboard = new Soundboard({ engine, clock, api, logger });
	/** @type {SoundboardEvent[]} */
	const events = [];
	for (const type of EVENT_TYPES) {
		soundboard.on(type, (event) => events.push(event));
	}
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	/** @param {number} seconds */
	const advance = async (seconds) => {
		clock.advance(seconds * 1000);
		await settle();
	};
	/** @param {SoundboardEvent['type']} type */
	const eventsOf = (type) => events.filter((event) => event.type === type);
	return { clock, engine, api, logged, soundboard, events, settle, advance, eventsOf };
}

async function started() {
	const context = setup();
	await context.soundboard.start();
	context.events.length = 0;
	return context;
}

describe('Soundboard', () => {
	describe('start', () => {
		it('unlocks audio synchronously, before anything is fetched', () => {
			const { soundboard, engine, api } = setup();
			const starting = soundboard.start();
			assert.equal(engine.unlockCount, 1);
			assert.equal(api.libraryRequests, 1);
			return starting;
		});

		it('loads the library and settings, applies the volumes, and announces it is ready', async () => {
			const { soundboard, engine, api, eventsOf } = setup({ canPlay: (format) => format === 'mp3' });
			api.settings = { volumes: { master: 0.5, music: 1, sfx: 0 } };
			await soundboard.start();

			assert.deepEqual(engine.busGains, { master: 0.25, music: 1, sfx: 0 });
			assert.deepEqual(eventsOf('app.ready'), [{
				type: 'app.ready',
				library: api.library,
				volumes: { master: 0.5, music: 1, sfx: 0 },
				unplayable: ['Combat/2.ogg', 'Rain.ogg'],
			}]);
			assert.deepEqual(soundboard.getLibrary(), api.library);
			assert.deepEqual(soundboard.getVolumes(), { master: 0.5, music: 1, sfx: 0 });
		});

		it('loads only once, however often it is started', async () => {
			const { soundboard, api, engine, eventsOf } = setup();
			await Promise.all([soundboard.start(), soundboard.start()]);
			await soundboard.start();
			assert.equal(api.libraryRequests, 1);
			assert.equal(engine.unlockCount, 3);
			assert.equal(eventsOf('app.ready').length, 1);
		});

		it('reports a failed start and can be retried', async () => {
			const { soundboard, api, eventsOf } = setup();
			api.libraryError = new Error('Failed to fetch');
			await soundboard.start();
			assert.deepEqual(eventsOf('app.startFailed'), [{ type: 'app.startFailed', message: 'Failed to fetch' }]);
			assert.throws(() => soundboard.playSound('Boom.mp3'), NotReadyError);

			api.libraryError = null;
			await soundboard.start();
			assert.equal(eventsOf('app.ready').length, 1);
		});

		it('rejects commands before it is ready', () => {
			const { soundboard } = setup();
			assert.throws(() => soundboard.togglePlaylist('Combat'), NotReadyError);
		});

		it('forwards audio interruptions', async () => {
			const { engine, events } = await started();
			engine.simulate('suspended');
			engine.simulate('resumed');
			assert.deepEqual(events, [{ type: 'audio.suspended' }, { type: 'audio.resumed' }]);
		});
	});

	describe('sounds', () => {
		it('plays and stops sounds, reporting their activity', async () => {
			const { soundboard, engine, eventsOf } = await started();
			soundboard.playSound('Rain.ogg');
			assert.equal(soundboard.isSoundActive('Rain.ogg'), true);
			assert.equal(engine.liveVoicesOn('sfx').length, 1);
			soundboard.stopSound('Rain.ogg');
			assert.equal(soundboard.isSoundActive('Rain.ogg'), false);
			assert.deepEqual(eventsOf('sound.activeChanged').map((event) => event.type === 'sound.activeChanged' && event.active), [true, false]);
		});

		it('rejects unknown sounds', async () => {
			const { soundboard } = await started();
			assert.throws(() => soundboard.playSound('Nope'), InvalidCommandError);
			assert.throws(() => soundboard.stopSound('Nope'), InvalidCommandError);
		});
	});

	describe('playlists', () => {
		it('toggles a playlist on and off', async () => {
			const { soundboard, engine } = await started();
			soundboard.togglePlaylist('Combat');
			assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'loading');
			assert.equal(engine.liveVoicesOn('music').length, 1);
			soundboard.togglePlaylist('Combat');
			assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'idle');
			assert.equal(engine.liveVoices.length, 0);
		});

		it('routes every playlist command to the player', async () => {
			const { soundboard, advance } = await started();
			soundboard.playPlaylist('Combat', { transition: 'instant' });
			await advance(0.1);
			soundboard.seek('Combat', 12);
			assert.equal(soundboard.getPlaylistSnapshot('Combat').position, 12);
			soundboard.pausePlaylist('Combat');
			assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'paused');
			soundboard.resumePlaylist('Combat');
			soundboard.nextTrack('Combat');
			assert.equal(soundboard.getPlaylistSnapshot('Combat').trackIndex, 1);
			soundboard.previousTrack('Combat', { transition: 'instant' });
			assert.equal(soundboard.getPlaylistSnapshot('Combat').trackIndex, 0);
			soundboard.jumpToTrack('Combat', 1);
			assert.equal(soundboard.getPlaylistSnapshot('Combat').trackIndex, 1);
			soundboard.stopPlaylist('Combat', { transition: 'instant' });
			assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'idle');
		});

		it('lists active playlists in the order they were started', async () => {
			const { soundboard } = await started();
			soundboard.togglePlaylist('Tavern');
			soundboard.togglePlaylist('Combat');
			soundboard.nextTrack('Tavern');
			assert.deepEqual(soundboard.getActivePlaylists().map((snapshot) => snapshot.playlistId), ['Tavern', 'Combat']);
			soundboard.togglePlaylist('Tavern');
			soundboard.togglePlaylist('Tavern');
			assert.deepEqual(soundboard.getActivePlaylists().map((snapshot) => snapshot.playlistId), ['Combat', 'Tavern']);
		});

		it('rejects unknown playlists', async () => {
			const { soundboard } = await started();
			assert.throws(() => soundboard.togglePlaylist('Nope'), InvalidCommandError);
			assert.throws(() => soundboard.getPlaylistSnapshot('Nope'), InvalidCommandError);
		});

		it('skips tracks the browser cannot play', async () => {
			const context = setup({ canPlay: (format) => format === 'mp3' });
			await context.soundboard.start();
			context.soundboard.jumpToTrack('Combat', 1);
			assert.equal(context.soundboard.getPlaylistSnapshot('Combat').trackIndex, 0);
			assert.equal(context.eventsOf('playlist.error').length, 1);
		});
	});

	describe('volume', () => {
		it('applies a volume change at once and saves it after a pause', async () => {
			const { soundboard, engine, api, clock, eventsOf } = await started();
			soundboard.setVolume('music', 0.5);
			soundboard.setVolume('music', 0.6);
			assert.equal(engine.busGains.music, 0.36);
			assert.equal(eventsOf('volume.changed').length, 2);
			assert.equal(api.saves.length, 0);
			clock.advance(500);
			assert.deepEqual(api.saves, [{ volumes: { master: 1, music: 0.6, sfx: 1 }, keepalive: false }]);
		});

		it('saves a pending change at once when flushed', async () => {
			const { soundboard, api } = await started();
			soundboard.setVolume('sfx', 0.2);
			soundboard.flushSettings();
			assert.deepEqual(api.saves, [{ volumes: { master: 1, music: 1, sfx: 0.2 }, keepalive: true }]);
		});
	});

	describe('dispatch', () => {
		it('accepts plain command objects, as a remote control would send them', async () => {
			const { soundboard } = await started();
			soundboard.dispatch(JSON.parse('{ "type": "playlist.play", "playlistId": "Tavern", "transition": "instant" }'));
			assert.equal(soundboard.getPlaylistSnapshot('Tavern').state, 'loading');
		});

		it('rejects malformed commands', async () => {
			const { soundboard } = await started();
			assert.throws(() => soundboard.dispatch({ type: 'playlist.explode' }), InvalidCommandError);
		});
	});

	describe('events', () => {
		it('keeps working when a UI handler throws, and logs the error', async () => {
			const { soundboard, logged } = await started();
			soundboard.on('sound.activeChanged', () => {
				throw new Error('UI bug');
			});
			soundboard.playSound('Rain.ogg');
			assert.equal(soundboard.isSoundActive('Rain.ogg'), true);
			assert.match(String(logged[0]?.[0]), /sound\.activeChanged/);
		});

		it('can unsubscribe', async () => {
			const { soundboard } = await started();
			let count = 0;
			const unsubscribe = soundboard.on('volume.changed', () => count++);
			soundboard.setVolume('music', 0.5);
			unsubscribe();
			soundboard.off('volume.changed', () => {});
			soundboard.setVolume('music', 0.4);
			assert.equal(count, 1);
		});

		it('only sends events that survive JSON serialization', async () => {
			const { soundboard, engine, events, advance } = setup({ canPlay: (format) => format === 'mp3' });
			engine.script('/media/Tavern/1.mp3', { loadError: 'Not found' });
			await soundboard.start();
			soundboard.playSound('Boom.mp3');
			soundboard.playSound('Rain.ogg');
			soundboard.togglePlaylist('Combat');
			soundboard.togglePlaylist('Tavern');
			soundboard.setVolume('master', 0.7);
			await advance(1);
			engine.simulate('suspended');
			assert.ok(new Set(events.map((event) => event.type)).size >= 8);
			for (const event of events) {
				assert.deepEqual(JSON.parse(JSON.stringify(event)), event, event.type);
			}
		});
	});
});
