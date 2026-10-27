import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCommandError, NotReadyError } from '../../public/app/logic/errors.js';
import { Soundboard } from '../../public/app/logic/soundboard.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeBackendApi } from '../helpers/fake-backend-api.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {import('../../public/app/logic/soundboard.js').SoundboardEvent} SoundboardEvent */

/** What every sound and track has without start and end points or fades. */
const NO_CLIP = { startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0 };

const EVENT_TYPES = /** @type {const} */ ([
	'app.ready', 'app.startFailed', 'audio.suspended', 'audio.resumed',
	'sound.activeChanged', 'sound.error',
	'playlist.stateChanged', 'playlist.progress', 'playlist.error',
	'volume.changed',
	'sound.changed', 'sound.saved', 'sound.saveFailed',
	'playlist.changed', 'playlist.saved', 'playlist.saveFailed',
	'track.saved', 'track.saveFailed',
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

	describe('customizing sounds', () => {
		it('applies a gain at once to playing and later instances', async () => {
			const { soundboard, engine } = await started();
			soundboard.playSound('Rain.ogg');
			soundboard.customizeSound('Rain.ogg', { gain: 2 });
			soundboard.playSound('Rain.ogg');
			assert.deepEqual(engine.voices.map((voice) => voice.gain), [2, 2]);
		});

		it('announces the changed sound and keeps the library sorted', async () => {
			const { soundboard, eventsOf } = await started();
			soundboard.customizeSound('Boom.mp3', { title: ' Thunder ' });
			assert.deepEqual(eventsOf('sound.changed'), [{
				type: 'sound.changed',
				sound: { id: 'Boom.mp3', title: 'Thunder', format: 'mp3', size: 1000, gain: 1, duration: 1.5, ...NO_CLIP, url: '/media/Boom.mp3' },
			}]);
			assert.deepEqual(soundboard.getLibrary()?.sounds.map((sound) => sound.title), ['Rain', 'Thunder']);
		});

		it('saves the full options 500 ms after the last change, then reports them saved', async () => {
			const { soundboard, api, clock, settle, eventsOf } = await started();
			soundboard.customizeSound('Boom.mp3', { title: 'Thunder' });
			soundboard.customizeSound('Boom.mp3', { gain: 0.5 });
			clock.advance(499);
			assert.deepEqual(api.soundSaves, []);
			clock.advance(1);
			assert.deepEqual(api.soundSaves, [{
				soundId: 'Boom.mp3',
				options: { title: 'Thunder', gain: 0.5, startAt: 0, endAt: null },
				keepalive: false,
			}]);
			await settle();
			assert.deepEqual(eventsOf('sound.saved'), [{ type: 'sound.saved', soundId: 'Boom.mp3' }]);
		});

		it('reports a failed save and keeps the change in effect', async () => {
			const { soundboard, api, clock, settle, eventsOf, logged } = await started();
			api.saveError = new Error('disk full');
			soundboard.customizeSound('Boom.mp3', { gain: 3 });
			clock.advance(500);
			await settle();
			assert.deepEqual(eventsOf('sound.saveFailed'), [{ type: 'sound.saveFailed', soundId: 'Boom.mp3', message: 'disk full' }]);
			assert.equal(soundboard.getLibrary()?.sounds[0].gain, 3);
			assert.equal(logged.length, 1);
		});

		it('saves at once when the sound is flushed, and with keepalive when the page closes', async () => {
			const { soundboard, api } = await started();
			soundboard.customizeSound('Boom.mp3', { gain: 0.5 });
			soundboard.flushSoundOptions('Boom.mp3');
			soundboard.customizeSound('Rain.ogg', { gain: 2 });
			soundboard.flushSettings();
			assert.deepEqual(api.soundSaves.map(({ soundId, keepalive }) => [soundId, keepalive]), [['Boom.mp3', false], ['Rain.ogg', true]]);
		});

		it('rejects an empty title or a bad gain without changing or saving anything', async () => {
			const { soundboard, api, clock, events } = await started();
			assert.throws(() => soundboard.customizeSound('Boom.mp3', { title: '' }), InvalidCommandError);
			assert.throws(() => soundboard.customizeSound('Boom.mp3', { gain: 5 }), InvalidCommandError);
			assert.throws(() => soundboard.customizeSound('Nope', { gain: 1 }), InvalidCommandError);
			clock.advance(1000);
			assert.deepEqual(api.soundSaves, []);
			assert.deepEqual(events, []);
		});
	});

	describe('sound start and end points', () => {
		it('plays later presses from the new points and leaves playing instances alone', async () => {
			const { soundboard, engine } = await started();
			soundboard.playSound('Rain.ogg');
			soundboard.customizeSound('Rain.ogg', { startAt: 5, endAt: 7.5 });
			soundboard.playSound('Rain.ogg');
			assert.deepEqual(engine.voices.map((voice) => [voice.startAt, voice.endAt]), [[0, null], [5, 7.5]]);
		});

		it('rounds the points to whole milliseconds and announces them', async () => {
			const { soundboard, eventsOf } = await started();
			soundboard.customizeSound('Rain.ogg', { startAt: 1.23456, endAt: 2.0004 });
			const [event] = eventsOf('sound.changed');
			assert.ok(event.type === 'sound.changed');
			assert.deepEqual([event.sound.startAt, event.sound.endAt], [1.235, 2]);
		});

		it('saves the points with the rest of the options, and clears the end point with null', async () => {
			const { soundboard, api, clock, settle } = await started();
			soundboard.customizeSound('Rain.ogg', { startAt: 1, endAt: 2 });
			clock.advance(500);
			await settle();
			soundboard.customizeSound('Rain.ogg', { endAt: null });
			clock.advance(500);
			assert.deepEqual(api.soundSaves.map(({ options }) => [options.startAt, options.endAt]), [[1, 2], [1, null]]);
		});

		it('rejects bad points, checking a change of one against the other, without changing or saving anything', async () => {
			const { soundboard, api, clock, eventsOf } = await started();
			soundboard.customizeSound('Rain.ogg', { startAt: 1, endAt: 2 });
			clock.advance(500);
			for (const change of [{ startAt: -1 }, { endAt: -0.5 }, { startAt: 1.995 }, { endAt: 1.009 }, { startAt: 3, endAt: 2 }]) {
				assert.throws(() => soundboard.customizeSound('Rain.ogg', change), InvalidCommandError, JSON.stringify(change));
			}
			clock.advance(1000);
			assert.equal(api.soundSaves.length, 1);
			assert.equal(eventsOf('sound.changed').length, 1);
			const rain = soundboard.getLibrary()?.sounds.find((sound) => sound.id === 'Rain.ogg');
			assert.deepEqual([rain?.startAt, rain?.endAt], [1, 2]);
		});
	});

	describe('customizing playlists', () => {
		it('applies a gain at once to the playing track and to later ones', async () => {
			const { soundboard, engine } = await started();
			soundboard.togglePlaylist('Combat');
			soundboard.customizePlaylist('Combat', { gain: 0.5 });
			soundboard.nextTrack('Combat', { transition: 'instant' });
			assert.deepEqual(engine.voices.map((voice) => voice.gain), [0.5, 0.5]);
		});

		it('announces the changed playlist and keeps the library sorted', async () => {
			const { soundboard, eventsOf } = await started();
			soundboard.customizePlaylist('Combat', { title: 'Zulu' });
			const [changed] = eventsOf('playlist.changed');
			assert.equal(changed.type === 'playlist.changed' && changed.playlist.title, 'Zulu');
			assert.deepEqual(soundboard.getLibrary()?.playlists.map((playlist) => playlist.title), ['Tavern', 'Zulu']);
		});

		it('uses a new crossfade for the next change of track, and saves it', async () => {
			const { soundboard, engine, api, advance } = await started();
			soundboard.togglePlaylist('Combat');
			await advance(1);
			soundboard.customizePlaylist('Combat', { crossfade: 2 });
			soundboard.nextTrack('Combat');
			const [old, fresh] = engine.voices;
			assert.deepEqual(old.gainRamps, [[0, 2]]);
			assert.deepEqual(fresh.gainRamps, [[0, 0], [1, 2]]);
			await advance(0.5);
			assert.equal(api.playlistSaves.at(-1)?.options.crossfade, 2);
		});

		it('uses new fades from the next play and stop', async () => {
			const { soundboard, engine, advance } = await started();
			soundboard.customizePlaylist('Tavern', { fadeIn: 1.5, fadeOut: 3 });
			soundboard.togglePlaylist('Tavern');
			assert.deepEqual(engine.voices[0].gainRamps, [[0, 0], [1, 1.5]]);
			await advance(2);
			soundboard.togglePlaylist('Tavern');
			assert.deepEqual(engine.voices[0].gainRamps.at(-1), [0, 3]);
		});

		it('saves debounced and reports it saved, or failed', async () => {
			const { soundboard, api, clock, settle, eventsOf } = await started();
			soundboard.customizePlaylist('Tavern', { gain: 2 });
			clock.advance(500);
			assert.deepEqual(api.playlistSaves, [{ playlistId: 'Tavern', options: { title: 'Tavern', gain: 2, crossfade: 0, fadeIn: 0, fadeOut: 0 }, keepalive: false }]);
			await settle();
			assert.deepEqual(eventsOf('playlist.saved'), [{ type: 'playlist.saved', playlistId: 'Tavern' }]);

			api.saveError = new Error('read-only');
			soundboard.customizePlaylist('Tavern', { gain: 3 });
			clock.advance(500);
			await settle();
			assert.deepEqual(eventsOf('playlist.saveFailed'), [{ type: 'playlist.saveFailed', playlistId: 'Tavern', message: 'read-only' }]);
		});

		it('saves at once when flushed, and with keepalive when the page closes', async () => {
			const { soundboard, api } = await started();
			soundboard.customizePlaylist('Combat', { gain: 0.5 });
			soundboard.flushPlaylistOptions('Combat');
			soundboard.customizePlaylist('Tavern', { gain: 2 });
			soundboard.flushSettings();
			assert.deepEqual(api.playlistSaves.map(({ playlistId, keepalive }) => [playlistId, keepalive]), [['Combat', false], ['Tavern', true]]);
		});

		it('rejects bad changes without changing or saving anything', async () => {
			const { soundboard, api, clock, events } = await started();
			assert.throws(() => soundboard.customizePlaylist('Combat', { title: ' ' }), InvalidCommandError);
			assert.throws(() => soundboard.customizePlaylist('Nope', { gain: 1 }), InvalidCommandError);
			clock.advance(1000);
			assert.deepEqual(api.playlistSaves, []);
			assert.deepEqual(events, []);
		});
	});

	describe('customizing tracks', () => {
		it('announces the playlist with the renamed track, and the footer gets the new title', async () => {
			const { soundboard, eventsOf } = await started();
			soundboard.togglePlaylist('Combat');
			soundboard.customizeTrack('Combat/1.mp3', { title: 'Opening' });
			const [changed] = eventsOf('playlist.changed');
			assert.deepEqual(changed.type === 'playlist.changed' && changed.playlist.tracks.map((track) => track.title), ['Opening', 'Boss']);
			assert.equal(soundboard.getPlaylistSnapshot('Combat').track?.title, 'Opening');
		});

		it('saves the title debounced and reports it per track', async () => {
			const { soundboard, api, clock, settle, eventsOf } = await started();
			soundboard.customizeTrack('Combat/2.ogg', { title: 'Final' });
			clock.advance(500);
			assert.deepEqual(api.trackSaves, [{ trackId: 'Combat/2.ogg', options: { title: 'Final' }, keepalive: false }]);
			await settle();
			assert.deepEqual(eventsOf('track.saved'), [{ type: 'track.saved', trackId: 'Combat/2.ogg' }]);

			api.saveError = new Error('read-only');
			soundboard.customizeTrack('Combat/2.ogg', { title: 'Finale' });
			soundboard.flushTrackOptions('Combat/2.ogg');
			await settle();
			assert.deepEqual(eventsOf('track.saveFailed'), [{ type: 'track.saveFailed', trackId: 'Combat/2.ogg', message: 'read-only' }]);
		});

		it('rejects empty titles and unknown tracks', async () => {
			const { soundboard, events } = await started();
			assert.throws(() => soundboard.customizeTrack('Combat/1.mp3', { title: ' ' }), InvalidCommandError);
			assert.throws(() => soundboard.customizeTrack('Nope.mp3', { title: 'X' }), InvalidCommandError);
			assert.deepEqual(events, []);
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
