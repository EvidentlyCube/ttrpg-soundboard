import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCommandError, NotReadyError } from '../../public/app/logic/errors.js';
import { Soundboard } from '../../public/app/logic/soundboard.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { exampleLibrary, FakeBackendApi } from '../helpers/fake-backend-api.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeWaveformDecoder } from '../helpers/fake-waveform-decoder.js';

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
	'voices.changed',
	'waveforms.progress', 'waveform.ready',
	'library.externalChanges', 'library.refreshing', 'library.refreshed', 'library.refreshFailed',
	'download.changed', 'download.log', 'sound.added', 'playlist.added', 'sound.removed', 'playlist.removed',
	'trash.changed',
]);

/** Stands in for the server's pushed messages; the test sends them with `push`. */
class FakeServerEvents {
	/** @type {((message: import('../../public/app/logic/ports.js').ServerMessage) => void) | null} */
	#onMessage = null;
	connections = 0;

	/** @type {import('../../public/app/logic/ports.js').ServerEvents['connect']} */
	connect(onMessage) {
		this.connections++;
		this.#onMessage = onMessage;
		return () => {
			this.#onMessage = null;
		};
	}

	/** @param {boolean} pending */
	push(pending) {
		this.#onMessage?.({ type: 'externalChanges', pending });
	}

	/** @param {import('../../public/app/logic/ports.js').ServerMessage} message */
	send(message) {
		this.#onMessage?.(message);
	}
}

/** @param {{ canPlay?: (format: 'mp3' | 'ogg') => boolean }} [options] */
function setup({ canPlay } = {}) {
	const clock = new FakeClock();
	const engine = new FakeAudioEngine(clock, { canPlay, defaultScript: { duration: 30, loadDelay: 0.1 } });
	const api = new FakeBackendApi();
	/** @type {unknown[][]} */
	const logged = [];
	const logger = { warn: (/** @type {unknown[]} */ ...args) => logged.push(args), error: (/** @type {unknown[]} */ ...args) => logged.push(args) };
	const serverEvents = new FakeServerEvents();
	const soundboard = new Soundboard({ engine, clock, api, logger, decoder: new FakeWaveformDecoder(), serverEvents });
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
	return { clock, engine, api, logged, serverEvents, soundboard, events, settle, advance, eventsOf };
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

	describe('voices', () => {
		it('lists the voices of sounds and tracks, oldest first, with their titles', async () => {
			const { soundboard, advance } = await started();
			soundboard.playSound('Rain.ogg');
			soundboard.playPlaylist('Combat');
			await advance(0.1);
			const voices = soundboard.getVoices();
			assert.deepEqual(voices.map((voice) => [voice.bus, voice.status]), [['sfx', 'playing'], ['music', 'playing']]);
			assert.equal(voices[0].label, soundboard.getLibrary()?.sounds.find((sound) => sound.id === 'Rain.ogg')?.title);
		});

		it('is empty before anything has played', async () => {
			const { soundboard } = await started();
			assert.deepEqual(soundboard.getVoices(), []);
		});

		it('keeps a stopped voice listed for 5 seconds, while the player has long released it', async () => {
			const { soundboard, engine, advance } = await started();
			soundboard.playSound('Rain.ogg');
			soundboard.stopSound('Rain.ogg');
			assert.equal(engine.liveVoices.length, 0);
			assert.equal(soundboard.getVoices()[0].status, 'stopped');
			await advance(4.9);
			assert.equal(soundboard.getVoices().length, 1);
			await advance(0.1);
			assert.deepEqual(soundboard.getVoices(), []);
		});

		it('announces when the list changes', async () => {
			const { soundboard, eventsOf, advance } = await started();
			soundboard.playSound('Rain.ogg');
			assert.equal(eventsOf('voices.changed').length, 1);
			soundboard.stopSound('Rain.ogg');
			assert.equal(eventsOf('voices.changed').length, 2);
			await advance(5);
			assert.equal(eventsOf('voices.changed').length, 3);
		});

		it('shows a playlist\'s fade-out while the old track is still sounding', async () => {
			const { soundboard, advance } = await started();
			soundboard.customizePlaylist('Combat', { fadeOut: 2 });
			soundboard.playPlaylist('Combat', { transition: 'instant' });
			await advance(0.1);
			soundboard.stopPlaylist('Combat');
			assert.equal(soundboard.getVoices()[0].status, 'fading out');
			await advance(1);
			assert.ok(soundboard.getVoices()[0].volume < 1);
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
				options: { title: 'Thunder', gain: 0.5, startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0 },
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

	describe('sound fades', () => {
		it('fades later presses in and out, leaving playing instances alone', async () => {
			const { soundboard, engine, advance } = await started();
			soundboard.playSound('Rain.ogg');
			soundboard.customizeSound('Rain.ogg', { fadeIn: 1, fadeOut: 2 });
			soundboard.playSound('Rain.ogg');
			await advance(30);
			assert.deepEqual(engine.voices.map((voice) => voice.gainRamps), [[], [[0, 0], [1, 1], [0, 2]]]);
		});

		it('saves the fades with the rest of the options', async () => {
			const { soundboard, api, clock } = await started();
			soundboard.customizeSound('Rain.ogg', { fadeIn: 0.5 });
			clock.advance(500);
			assert.deepEqual(api.soundSaves[0].options, { title: 'Rain', gain: 1, startAt: 0, endAt: null, fadeIn: 0.5, fadeOut: 0 });
		});

		it('rejects fades out of range', async () => {
			const { soundboard } = await started();
			assert.throws(() => soundboard.customizeSound('Rain.ogg', { fadeIn: -1 }), InvalidCommandError);
			assert.throws(() => soundboard.customizeSound('Rain.ogg', { fadeOut: 31 }), InvalidCommandError);
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

		it('applies a new order to the playing playlist at once, and saves it', async () => {
			const { soundboard, api, clock } = await started();
			soundboard.jumpToTrack('Combat', 1);
			soundboard.customizePlaylist('Combat', { order: 'shuffle' });
			assert.equal(soundboard.getLibrary()?.playlists.find((playlist) => playlist.id === 'Combat')?.order, 'shuffle');
			// A shuffled history refilled around the current track has nothing before it.
			soundboard.previousTrack('Combat', { transition: 'instant' });
			assert.equal(soundboard.getPlaylistSnapshot('Combat').trackIndex, 1);
			clock.advance(500);
			assert.equal(api.playlistSaves[0].options.order, 'shuffle');
		});

		it('rejects an unknown stop mode', async () => {
			const { soundboard } = await started();
			assert.throws(() => soundboard.customizePlaylist('Combat', /** @type {any} */ ({ stopMode: 'forever' })), InvalidCommandError);
		});

		it('resumes a stopped playlist by its stop mode, saves the mode, and forgets on request', async () => {
			const { soundboard, api, clock, advance } = await started();
			soundboard.customizePlaylist('Combat', { stopMode: 'resetTrack' });
			soundboard.jumpToTrack('Combat', 1);
			await advance(1);
			soundboard.stopPlaylist('Combat');
			assert.equal(soundboard.getPlaylistSnapshot('Combat').resume?.trackIndex, 1);
			soundboard.forgetPlaylist('Combat');
			assert.equal(soundboard.getPlaylistSnapshot('Combat').resume, null);
			soundboard.customizePlaylist('Combat', { stopMode: 'pause' });
			soundboard.jumpToTrack('Combat', 1);
			await advance(1);
			soundboard.stopPlaylist('Combat');
			soundboard.togglePlaylist('Combat');
			assert.equal(soundboard.getPlaylistSnapshot('Combat').trackIndex, 1);
			clock.advance(500);
			assert.equal(api.playlistSaves.at(-1)?.options.stopMode, 'pause');
		});

		it('applies track looping to the playing track at once, and saves it', async () => {
			const { soundboard, api, clock, engine } = await started();
			soundboard.togglePlaylist('Combat');
			soundboard.customizePlaylist('Combat', { trackLooping: true });
			assert.equal(engine.liveVoicesOn('music')[0].looping, true);
			clock.advance(500);
			assert.equal(api.playlistSaves[0].options.trackLooping, true);
			assert.throws(() => soundboard.dispatch({ type: 'playlist.customize', playlistId: 'Combat', trackLooping: 'yes' }), InvalidCommandError);
		});

		it('rejects an unknown order', async () => {
			const { soundboard } = await started();
			assert.throws(() => soundboard.customizePlaylist('Combat', /** @type {any} */ ({ order: 'backwards' })), InvalidCommandError);
			assert.throws(() => soundboard.dispatch({ type: 'playlist.customize', playlistId: 'Combat', order: 3 }), InvalidCommandError);
		});

		it('saves debounced and reports it saved, or failed', async () => {
			const { soundboard, api, clock, settle, eventsOf } = await started();
			soundboard.customizePlaylist('Tavern', { gain: 2 });
			clock.advance(500);
			assert.deepEqual(api.playlistSaves, [{
				playlistId: 'Tavern',
				options: { title: 'Tavern', gain: 2, crossfade: 0, fadeIn: 0, fadeOut: 0, order: 'ordered', trackLooping: false, stopMode: 'resetPlaylist' },
				keepalive: false,
			}]);
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
			assert.deepEqual(api.trackSaves, [{ trackId: 'Combat/2.ogg', options: { title: 'Final', gain: 1, startAt: 0, endAt: null }, keepalive: false }]);
			await settle();
			assert.deepEqual(eventsOf('track.saved'), [{ type: 'track.saved', trackId: 'Combat/2.ogg' }]);

			api.saveError = new Error('read-only');
			soundboard.customizeTrack('Combat/2.ogg', { title: 'Finale' });
			soundboard.flushTrackOptions('Combat/2.ogg');
			await settle();
			assert.deepEqual(eventsOf('track.saveFailed'), [{ type: 'track.saveFailed', trackId: 'Combat/2.ogg', message: 'read-only' }]);
		});

		it('announces new points with the playlist and saves them with the title', async () => {
			const { soundboard, api, clock, eventsOf } = await started();
			soundboard.customizeTrack('Combat/1.mp3', { startAt: 1.5, endAt: 20 });
			const [changed] = eventsOf('playlist.changed');
			const track = changed.type === 'playlist.changed' ? changed.playlist.tracks[0] : null;
			assert.deepEqual([track?.startAt, track?.endAt], [1.5, 20]);
			clock.advance(500);
			assert.deepEqual(api.trackSaves.map((save) => save.options), [{ title: 'Battle', gain: 1, startAt: 1.5, endAt: 20 }]);
		});

		it('saves a gain with the other options, and a playing track follows it at once', async () => {
			const { soundboard, api, clock, engine, eventsOf, settle } = await started();
			soundboard.togglePlaylist('Combat');
			await settle();
			soundboard.customizeTrack('Combat/1.mp3', { gain: 0.5 });
			const [changed] = eventsOf('playlist.changed');
			assert.equal(changed.type === 'playlist.changed' && changed.playlist.tracks[0].gain, 0.5);
			assert.equal(engine.voices.at(-1)?.gain, 0.5 * (soundboard.getLibrary()?.playlists[0].gain ?? 1));
			clock.advance(500);
			assert.deepEqual(api.trackSaves.map((save) => save.options), [{ title: 'Battle', gain: 0.5, startAt: 0, endAt: null }]);
		});

		it('rejects points that do not fit together, announcing and saving nothing', async () => {
			const { soundboard, api, clock, events } = await started();
			assert.throws(() => soundboard.customizeTrack('Combat/1.mp3', { startAt: 5, endAt: 5 }), InvalidCommandError);
			assert.throws(() => soundboard.dispatch({ type: 'track.customize', trackId: 'Combat/1.mp3', startAt: 'x' }), InvalidCommandError);
			clock.advance(500);
			assert.deepEqual(events, []);
			assert.deepEqual(api.trackSaves, []);
		});

		it('rejects empty titles and unknown tracks', async () => {
			const { soundboard, events } = await started();
			assert.throws(() => soundboard.customizeTrack('Combat/1.mp3', { title: ' ' }), InvalidCommandError);
			assert.throws(() => soundboard.customizeTrack('Nope.mp3', { title: 'X' }), InvalidCommandError);
			assert.deepEqual(events, []);
		});
	});

	describe('downloads', () => {
		/** @returns {import('../../public/app/logic/ports.js').DownloadJob} */
		const job = (id = 'job-1', state = /** @type {'running' | 'done'} */ ('running')) => ({
			id, title: 'Zoo', target: { kind: 'sound' }, targetTitle: 'Sound effects', state, items: [], current: null, added: 0, failed: 0,
		});
		const file = (/** @type {string} */ id) => ({
			id, title: id, format: /** @type {const} */ ('mp3'), size: 1, gain: 1, duration: 5, startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0, url: `/media/${id}`,
		});

		it('knows the tools and a download already running when it starts', async () => {
			const { soundboard, api } = setup();
			api.download = { tools: { ytDlp: null, ffmpeg: '7.1' }, job: { ...job(), log: ['one', 'two'] } };
			await soundboard.start();
			assert.deepEqual(soundboard.getDownloadTools(), { ytDlp: null, ffmpeg: '7.1' });
			assert.deepEqual(soundboard.getDownload(), { job: job(), log: ['one', 'two'] });
		});

		it('starts without download information when the server can\'t give it', async () => {
			const { soundboard, api, eventsOf } = setup();
			api.fetchDownload = async () => {
				throw new Error('offline');
			};
			await soundboard.start();
			assert.equal(eventsOf('app.ready').length, 1);
			assert.deepEqual(soundboard.getDownloadTools(), { ytDlp: null, ffmpeg: null });
		});

		it('follows the job and its log, replacing progress lines', async () => {
			const { soundboard, serverEvents, eventsOf } = await started();
			serverEvents.send({ type: 'download', job: job(), log: ['$ yt-dlp'] });
			serverEvents.send({ type: 'download.log', lines: ['10%'], replaceLast: false });
			serverEvents.send({ type: 'download.log', lines: ['50%', 'done'], replaceLast: true });
			assert.deepEqual(soundboard.getDownload()?.log, ['$ yt-dlp', '50%', 'done']);
			serverEvents.send({ type: 'download', job: job('job-1', 'done') });
			assert.deepEqual(soundboard.getDownload()?.log, ['$ yt-dlp', '50%', 'done']);
			assert.deepEqual(eventsOf('download.changed').map((event) => event.type === 'download.changed' && [event.job?.state, event.logReset]), [['running', true], ['done', false]]);
			serverEvents.send({ type: 'download', job: job('job-2') });
			assert.deepEqual(soundboard.getDownload()?.log, []);
			serverEvents.send({ type: 'download', job: null });
			assert.equal(soundboard.getDownload(), null);
		});

		it('passes lookups and downloads to the server', async () => {
			const { soundboard, api, eventsOf } = await started();
			api.probe = { probeId: 'p1', kind: 'file', url: 'https://x/a.mp3', name: 'a.mp3', size: 3, contentType: 'audio/mpeg' };
			assert.equal((await soundboard.probeLink('https://x/a.mp3')).kind, 'file');
			await soundboard.probeLink('https://x/watch?v=1&list=2', { playlist: true });
			assert.deepEqual(api.probes, [{ url: 'https://x/a.mp3', playlist: false }, { url: 'https://x/watch?v=1&list=2', playlist: true }]);
			api.probe = new Error('Unsupported URL');
			await assert.rejects(soundboard.probeLink('https://nope/'), /Unsupported URL/);

			await soundboard.startDownload({ probeId: 'p1', target: { kind: 'sound' } });
			assert.deepEqual(api.downloadRequests, [{ probeId: 'p1', target: { kind: 'sound' } }]);
			assert.equal(soundboard.getDownload()?.job.id, 'job-1');
			assert.equal(eventsOf('download.changed').length, 1);
			soundboard.dismissDownload();
			await Promise.resolve();
			assert.equal(api.dismissals, 1);
		});

		it('adds a new sound once, wherever the message comes from, and makes its waveform', async () => {
			const { soundboard, serverEvents, api, eventsOf, settle } = await started();
			api.missingWaveforms = ['New.mp3'];
			serverEvents.send({ type: 'library.added', sound: file('New.mp3') });
			serverEvents.send({ type: 'library.added', sound: file('New.mp3') });
			assert.deepEqual(eventsOf('sound.added'), [{ type: 'sound.added', sound: file('New.mp3') }]);
			assert.ok(soundboard.getLibrary()?.sounds.some((sound) => sound.id === 'New.mp3'));
			assert.doesNotThrow(() => soundboard.playSound('New.mp3'));
			await settle();
			assert.equal(soundboard.getWaveformStatus().total, 1);
		});

		it('adds a new playlist with a player of its own', async () => {
			const { soundboard, serverEvents, eventsOf } = await started();
			const playlist = { ...exampleLibrary().playlists[1], id: 'Dungeon', title: 'Dungeon', tracks: [file('Dungeon/1.mp3')] };
			serverEvents.send({ type: 'library.added', playlist });
			assert.deepEqual(eventsOf('playlist.added'), [{ type: 'playlist.added', playlist }]);
			soundboard.playPlaylist('Dungeon');
			assert.equal(soundboard.getPlaylistSnapshot('Dungeon').state, 'loading');
		});

		it('gives a playlist that is playing its new tracks without interrupting it', async () => {
			const { soundboard, serverEvents, eventsOf, engine } = await started();
			soundboard.playPlaylist('Combat');
			const playing = engine.voices.at(-1);
			const combat = exampleLibrary().playlists[0];
			const added = { ...combat, tracks: [file('Combat/0.mp3'), ...combat.tracks] };
			serverEvents.send({ type: 'library.added', playlist: added });
			serverEvents.send({ type: 'library.added', playlist: added });
			const changed = eventsOf('playlist.changed');
			assert.equal(changed.length, 1);
			assert.deepEqual(changed[0].type === 'playlist.changed' && changed[0].playlist.tracks.map((track) => track.id), ['Combat/0.mp3', 'Combat/1.mp3', 'Combat/2.ogg']);
			assert.equal(engine.voices.at(-1), playing);
			assert.equal(soundboard.getPlaylistSnapshot('Combat').trackIndex, 1);
		});
	});

	describe('deleting and moving', () => {
		const file = (/** @type {string} */ id) => ({
			id, title: id, format: /** @type {const} */ ('mp3'), size: 1, gain: 1, duration: 5, startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0, url: `/media/${id}`,
		});

		it('saves pending changes first, then asks the server and applies its answer', async () => {
			const { soundboard, api, eventsOf } = await started();
			soundboard.customizeSound('Boom.mp3', { gain: 0.5 });
			api.rearrangement = [{ type: 'library.removed', soundId: 'Boom.mp3' }];
			await soundboard.deleteSound('Boom.mp3');
			assert.equal(api.soundSaves.length, 1);
			assert.deepEqual(api.rearrangements, [{ delete: { kind: 'sound', id: 'Boom.mp3' } }]);
			assert.deepEqual(eventsOf('sound.removed'), [{ type: 'sound.removed', soundId: 'Boom.mp3' }]);
			assert.deepEqual(soundboard.getLibrary()?.sounds.map((sound) => sound.id), ['Rain.ogg']);
			assert.throws(() => soundboard.playSound('Boom.mp3'), InvalidCommandError);
		});

		it('passes each kind of request on', async () => {
			const { soundboard, api } = await started();
			await soundboard.deleteTrack('Combat/1.mp3');
			await soundboard.deletePlaylist('Tavern');
			await soundboard.moveSound('Boom.mp3', 'Combat');
			await soundboard.moveTrack('Combat/1.mp3', null);
			assert.deepEqual(api.rearrangements, [
				{ delete: { kind: 'track', id: 'Combat/1.mp3' } },
				{ delete: { kind: 'playlist', id: 'Tavern' } },
				{ move: { id: 'Boom.mp3', to: 'Combat' } },
				{ move: { id: 'Combat/1.mp3', to: null } },
			]);
		});

		it('rejects with the server\'s message and changes nothing', async () => {
			const { soundboard, api, eventsOf } = await started();
			api.rearrangement = new Error('The track is already in that playlist');
			await assert.rejects(soundboard.moveTrack('Combat/1.mp3', 'Combat'), /already in that playlist/);
			assert.equal(eventsOf('playlist.changed').length, 0);
		});

		it('stops a removed sound at once, and applies each removal only once', async () => {
			const { soundboard, serverEvents, engine, eventsOf } = await started();
			soundboard.playSound('Rain.ogg');
			assert.equal(soundboard.isSoundActive('Rain.ogg'), true);
			serverEvents.send({ type: 'library.removed', soundId: 'Rain.ogg' });
			serverEvents.send({ type: 'library.removed', soundId: 'Rain.ogg' });
			assert.equal(soundboard.isSoundActive('Rain.ogg'), false);
			assert.equal(engine.liveVoicesOn('sfx').length, 0);
			assert.equal(eventsOf('sound.removed').length, 1);
		});

		it('takes a track out of its playlist; one that is playing stops the playlist', async () => {
			const { soundboard, serverEvents, engine, eventsOf } = await started();
			soundboard.playPlaylist('Combat');
			serverEvents.send({ type: 'library.removed', trackId: 'Combat/1.mp3', playlistId: 'Combat' });
			assert.equal(soundboard.getPlaylistSnapshot('Combat').state, 'idle');
			assert.equal(engine.liveVoicesOn('music').length, 0);
			const changed = eventsOf('playlist.changed').at(-1);
			assert.deepEqual(changed?.type === 'playlist.changed' && changed.playlist.tracks.map((track) => track.id), ['Combat/2.ogg']);
			serverEvents.send({ type: 'library.removed', trackId: 'Combat/1.mp3', playlistId: 'Combat' });
			assert.equal(eventsOf('playlist.changed').length, 1);
		});

		it('removes a playlist, stopping it first', async () => {
			const { soundboard, serverEvents, eventsOf } = await started();
			soundboard.playPlaylist('Tavern');
			serverEvents.send({ type: 'library.removed', playlistId: 'Tavern' });
			assert.deepEqual(eventsOf('playlist.removed'), [{ type: 'playlist.removed', playlistId: 'Tavern' }]);
			assert.equal(soundboard.getActivePlaylists().length, 0);
			assert.deepEqual(soundboard.getLibrary()?.playlists.map((playlist) => playlist.id), ['Combat']);
			assert.throws(() => soundboard.playPlaylist('Tavern'), InvalidCommandError);
		});

		it('follows a move as a removal and an addition', async () => {
			const { soundboard, api, eventsOf } = await started();
			const combat = exampleLibrary().playlists[0];
			api.rearrangement = [
				{ type: 'library.removed', soundId: 'Boom.mp3' },
				{ type: 'library.added', playlist: { ...combat, tracks: [...combat.tracks, file('Combat/Boom.mp3')] } },
			];
			await soundboard.moveSound('Boom.mp3', 'Combat');
			assert.equal(eventsOf('sound.removed').length, 1);
			const changed = eventsOf('playlist.changed').at(-1);
			assert.deepEqual(changed?.type === 'playlist.changed' && changed.playlist.tracks.map((track) => track.id), ['Combat/1.mp3', 'Combat/2.ogg', 'Combat/Boom.mp3']);
		});

		it('decodes a new file at a removed sound\'s URL afresh', async () => {
			const { soundboard, serverEvents, engine, advance } = await started();
			soundboard.playSound('Boom.mp3');
			await advance(1);
			const loads = engine.bufferLoads.length;
			serverEvents.send({ type: 'library.removed', soundId: 'Boom.mp3' });
			serverEvents.send({ type: 'library.added', sound: { ...file('Boom.mp3'), size: 1000 } });
			soundboard.playSound('Boom.mp3');
			assert.equal(engine.bufferLoads.length, loads + 1);
		});
	});

	describe('regenerating waveforms', () => {
		it('makes every sound\'s and track\'s waveform again, sounds first', async () => {
			const { soundboard, api, advance } = await started();
			// Each file rests a while before the next, so time moves on in steps.
			const finish = async () => {
				for (let step = 0; step < 20; step++) {
					await advance(1);
				}
			};
			await finish();
			api.waveforms.clear();
			soundboard.regenerateWaveforms();
			await finish();
			const library = exampleLibrary();
			assert.deepEqual([...api.waveforms.keys()], [...library.sounds, ...library.playlists.flatMap((playlist) => playlist.tracks)].map((file) => file.id));
		});
	});

	describe('the trash', () => {
		it('follows the server\'s summary, announcing only real changes', async () => {
			const { soundboard, serverEvents, eventsOf } = await started();
			assert.deepEqual(soundboard.trashSummary(), { size: 0, count: 0 });
			serverEvents.send({ type: 'trash', size: 2000, count: 1 });
			serverEvents.send({ type: 'trash', size: 2000, count: 1 });
			assert.deepEqual(soundboard.trashSummary(), { size: 2000, count: 1 });
			assert.deepEqual(eventsOf('trash.changed'), [{ type: 'trash.changed', size: 2000, count: 1 }]);
		});

		it('fetches the listing', async () => {
			const { soundboard, api } = await started();
			api.trash = { size: 4, playlists: [], sounds: [{ id: 'Old.mp3', title: 'Old', size: 4 }] };
			assert.deepEqual(await soundboard.loadTrash(), api.trash);
		});

		it('saves pending changes, restores, and applies what came back', async () => {
			const { soundboard, api, eventsOf } = await started();
			soundboard.customizeSound('Boom.mp3', { gain: 0.5 });
			api.rearrangement = [{
				type: 'library.added',
				sound: { id: 'Old.mp3', title: 'Old', format: 'mp3', size: 1, gain: 1, duration: 5, startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0, url: '/media/Old.mp3' },
			}];
			await soundboard.restoreFromTrash({ kind: 'sound', id: 'Old.mp3' });
			assert.equal(api.soundSaves.length, 1);
			assert.deepEqual(api.trashRequests, [{ restore: { kind: 'sound', id: 'Old.mp3' } }]);
			assert.deepEqual(eventsOf('sound.added').map((event) => event.type === 'sound.added' && event.sound.id), ['Old.mp3']);
		});

		it('deletes for good, and rejects with the server\'s message', async () => {
			const { soundboard, api } = await started();
			await soundboard.deleteFromTrash('all');
			assert.deepEqual(api.trashRequests, [{ purge: 'all' }]);
			api.rearrangement = new Error('There is no sound "x" in the trash');
			await assert.rejects(soundboard.deleteFromTrash({ kind: 'sound', id: 'x' }), /no sound "x"/);
		});
	});

	describe('external changes', () => {
		it('listens to the server once the library has loaded', async () => {
			const { soundboard, serverEvents } = setup();
			assert.equal(serverEvents.connections, 0);
			await soundboard.start();
			assert.equal(serverEvents.connections, 1);
		});

		it('announces when the server reports changes, and when they are gone', async () => {
			const { soundboard, serverEvents, eventsOf } = await started();
			serverEvents.push(false);
			assert.deepEqual(eventsOf('library.externalChanges'), []);
			serverEvents.push(true);
			serverEvents.push(true);
			assert.equal(soundboard.hasExternalChanges(), true);
			serverEvents.push(false);
			assert.equal(soundboard.hasExternalChanges(), false);
			assert.deepEqual(eventsOf('library.externalChanges'), [
				{ type: 'library.externalChanges', pending: true },
				{ type: 'library.externalChanges', pending: false },
			]);
		});

		it('asks the server for a check and announces what it found', async () => {
			const { soundboard, api, eventsOf, settle } = await started();
			api.externalChanges = true;
			soundboard.checkExternalChanges();
			await settle();
			assert.equal(api.checkRequests, 1);
			assert.deepEqual(eventsOf('library.externalChanges'), [{ type: 'library.externalChanges', pending: true }]);
		});

		it('checks nothing before the library has loaded, and only once at a time', async () => {
			const { soundboard, api, settle } = setup();
			soundboard.checkExternalChanges();
			assert.equal(api.checkRequests, 0);
			await soundboard.start();
			soundboard.checkExternalChanges();
			soundboard.checkExternalChanges();
			assert.equal(api.checkRequests, 1);
			await settle();
			soundboard.checkExternalChanges();
			assert.equal(api.checkRequests, 2);
		});

		it('logs a check that failed', async () => {
			const { soundboard, api, logged, settle } = await started();
			api.checkExternalChanges = async () => {
				throw new Error('offline');
			};
			soundboard.checkExternalChanges();
			await settle();
			assert.match(String(logged[0]?.[0]), /Could not check the audio directory/);
		});
	});

	describe('refreshing the library', () => {
		it('saves pending changes first, then has the server rebuild', async () => {
			const { soundboard, api, eventsOf } = await started();
			soundboard.customizeSound('Boom.mp3', { title: 'Big Boom' });
			soundboard.setVolume('music', 0.5);
			/** @type {number[]} */
			const savesWhenRefreshed = [];
			api.refresh = async () => {
				savesWhenRefreshed.push(api.soundSaves.length, api.saves.length);
				return { status: 'refreshed' };
			};
			await soundboard.refreshLibrary();
			assert.deepEqual(savesWhenRefreshed, [1, 1]);
			assert.deepEqual(api.soundSaves.map(({ options, keepalive }) => [options.title, keepalive]), [['Big Boom', false]]);
			assert.deepEqual(eventsOf('library.refreshing').length, 1);
			assert.deepEqual(eventsOf('library.refreshed'), [{ type: 'library.refreshed' }]);
		});

		it('reports invalid options files', async () => {
			const { soundboard, api, eventsOf } = await started();
			api.refreshResult = { status: 'invalid', errors: [{ path: 'Boom.mp3.json', message: 'invalid JSON' }] };
			await soundboard.refreshLibrary();
			assert.deepEqual(eventsOf('library.refreshFailed'), [{
				type: 'library.refreshFailed',
				message: 'Some options files are invalid.',
				errors: [{ path: 'Boom.mp3.json', message: 'invalid JSON' }],
				restartNeeded: false,
			}]);
		});

		it('reports when only a restart can help', async () => {
			const { soundboard, api, eventsOf } = await started();
			api.refreshResult = { status: 'restartNeeded', message: 'The .soundboard file is gone. Restart the app.' };
			await soundboard.refreshLibrary();
			assert.deepEqual(eventsOf('library.refreshFailed'), [{
				type: 'library.refreshFailed',
				message: 'The .soundboard file is gone. Restart the app.',
				errors: [],
				restartNeeded: true,
			}]);
		});

		it('reports and logs a refresh that could not be sent', async () => {
			const { soundboard, api, eventsOf, logged } = await started();
			api.refresh = async () => {
				throw new Error('offline');
			};
			await soundboard.refreshLibrary();
			assert.deepEqual(eventsOf('library.refreshFailed'), [{ type: 'library.refreshFailed', message: 'offline', errors: [], restartNeeded: false }]);
			assert.match(String(logged[0]?.[0]), /Could not refresh the library/);
		});

		it('ignores a second request while one runs', async () => {
			const { soundboard, api } = await started();
			await Promise.all([soundboard.refreshLibrary(), soundboard.refreshLibrary()]);
			assert.equal(api.refreshRequests, 1);
			await soundboard.refreshLibrary();
			assert.equal(api.refreshRequests, 2);
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

		it('starts making the missing waveforms once the library has loaded', async () => {
			const { soundboard, api, eventsOf, advance } = setup();
			api.missingWaveforms = ['Boom.mp3'];
			await soundboard.start();
			await advance(1);
			await advance(1);
			assert.deepEqual([...api.waveforms.keys()], ['Boom.mp3']);
			assert.equal(eventsOf('waveform.ready').length, 1);
			assert.deepEqual(soundboard.getWaveformStatus(), { running: false, done: 1, total: 1, failed: 0 });
			assert.ok(await soundboard.getWaveform('Boom.mp3'));
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
