import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCommandError } from '../../public/app/logic/errors.js';
import { DEFAULT_PLAYBACK_RULES } from '../../public/app/logic/playback-rules.js';
import { PlaylistPlayer } from '../../public/app/logic/playlist-player.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { seededRandom } from '../helpers/seeded-random.js';

/** @typedef {import('../../public/app/logic/playlist-player.js').PlaylistEvent} PlaylistEvent */
/** @typedef {import('../../public/app/logic/playback-rules.js').PlaybackRules} PlaybackRules */

/**
 * @param {number} count
 * @param {{ gain?: number, trackGains?: number[] }} [gains]
 * @returns {import('../../public/app/logic/ports.js').PlaylistJson}
 */
function playlistOf(count, { gain = 1, trackGains = [] } = {}) {
	return {
		id: 'Combat',
		title: 'Combat',
		gain,
		crossfade: 0,
		fadeIn: 0,
		fadeOut: 0,
		order: 'ordered',
		trackLooping: false,
		stopMode: 'resetPlaylist',
		tracks: Array.from({ length: count }, (_, i) => ({ id: `Combat/${i}.mp3`, title: `Track ${i}`, format: 'mp3', size: 1000, gain: trackGains[i] ?? 1, duration: 10, startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0, url: `/t${i}` })),
	};
}

/**
 * @param {object} [options]
 * @param {number} [options.tracks]
 * @param {Partial<PlaybackRules>} [options.rules]
 * @param {(track: import('../../public/app/logic/ports.js').AudioFileJson) => boolean} [options.isPlayable]
 * @param {{ gain?: number, trackGains?: number[] }} [options.gains]
 * @param {number} [options.seed] for the random orders
 */
function setup({ tracks = 3, rules = {}, isPlayable, gains, seed = 1 } = {}) {
	const clock = new FakeClock();
	const engine = new FakeAudioEngine(clock, { defaultScript: { duration: 10, loadDelay: 0.1 } });
	/** @type {PlaylistEvent[]} */
	const events = [];
	const player = new PlaylistPlayer({
		playlist: playlistOf(tracks, gains),
		engine,
		clock,
		emit: (event) => events.push(event),
		rules: { ...DEFAULT_PLAYBACK_RULES, ...rules },
		isPlayable,
		random: seededRandom(seed),
	});
	/** @param {number} seconds */
	const advance = (seconds) => clock.advance(seconds * 1000);
	/** @param {PlaylistEvent['type']} type */
	const eventsOf = (type) => events.filter((event) => event.type === type);
	const states = () => eventsOf('playlist.stateChanged').map((event) => (event.type === 'playlist.stateChanged' ? `${event.state}:${event.trackIndex}` : ''));
	const current = () => {
		const live = engine.liveVoicesOn('music');
		assert.ok(live.length <= 1, `expected at most one live voice, got ${live.length}`);
		return live[0];
	};
	return { clock, engine, events, player, advance, eventsOf, states, current };
}

describe('PlaylistPlayer', () => {
	describe('playing', () => {
		it('calls play() synchronously, so it happens inside the user gesture', () => {
			const { player, engine } = setup();
			player.play();
			assert.equal(engine.voices.length, 1);
			assert.equal(engine.voices[0].url, '/t0');
			assert.equal(engine.voices[0].bus, 'music');
			assert.equal(engine.voices[0].playCalls, 1);
		});

		it('goes from loading to playing once the track has loaded', () => {
			const { player, advance, states } = setup();
			player.play();
			assert.equal(player.state, 'loading');
			advance(0.1);
			assert.equal(player.state, 'playing');
			assert.deepEqual(states(), ['loading:0', 'playing:0']);
		});

		it('describes the state with serializable events', () => {
			const { player, advance, eventsOf } = setup();
			player.play();
			advance(0.1);
			const [loading, playing] = eventsOf('playlist.stateChanged');
			assert.deepEqual(loading, {
				type: 'playlist.stateChanged',
				playlistId: 'Combat',
				state: 'loading',
				trackIndex: 0,
				track: playlistOf(3).tracks[0],
				duration: null,
				crossfadeFrom: null,
				resume: null,
			});
			assert.equal(playing.type === 'playlist.stateChanged' && playing.duration, 10);
			assert.deepEqual(JSON.parse(JSON.stringify(loading)), loading);
		});

		it('ignores play while already active', () => {
			const { player, engine, advance } = setup();
			player.play();
			advance(0.1);
			player.play();
			assert.equal(engine.voices.length, 1);
		});

		it('advances to the next track when one ends, and wraps around', () => {
			const { player, advance, states, engine } = setup({ tracks: 2 });
			player.play();
			advance(0.1 + 10 + 0.1 + 10 + 0.1);
			assert.deepEqual(states(), ['loading:0', 'playing:0', 'loading:1', 'playing:1', 'loading:0', 'playing:0']);
			assert.equal(engine.liveVoicesOn('music').length, 1);
		});

		it('stops after the last track when not looping', () => {
			const { player, advance, engine } = setup({ tracks: 2, rules: { playlistLooping: false } });
			player.play();
			advance(30);
			assert.equal(player.state, 'idle');
			assert.equal(engine.liveVoices.length, 0);
		});

		it('does nothing for an empty playlist', () => {
			const { player, engine, events } = setup({ tracks: 0 });
			player.play();
			assert.equal(player.state, 'idle');
			assert.equal(engine.voices.length, 0);
			assert.deepEqual(events, []);
		});
	});

	describe('stopping', () => {
		it('stops the voice and goes idle', () => {
			const { player, advance, engine, clock, states } = setup();
			player.play();
			advance(1);
			player.stop();
			assert.equal(player.state, 'idle');
			assert.equal(engine.liveVoices.length, 0);
			assert.equal(clock.pendingTimerCount, 0);
			assert.deepEqual(states().at(-1), 'idle:null');
		});

		it('ignores stop while idle', () => {
			const { player, events } = setup();
			player.stop();
			assert.deepEqual(events, []);
		});

		describe('what stopping remembers', () => {
			/** @param {import('../../public/app/logic/playback-rules.js').StopMode} stopMode */
			function playedFor4Seconds(stopMode) {
				const harness = setup({ rules: { stopMode } });
				harness.player.jumpTo(1);
				harness.advance(4);
				return harness;
			}

			it('remembers nothing by default', () => {
				const { player } = playedFor4Seconds('resetPlaylist');
				player.stop();
				assert.equal(player.snapshot().resume, null);
				player.play();
				assert.equal(player.snapshot().trackIndex, 0);
			});

			it('continues the same track where it stopped with pause', () => {
				const { player, advance } = playedFor4Seconds('pause');
				player.stop();
				const { resume } = player.snapshot();
				assert.equal(resume?.trackIndex, 1);
				assert.equal(resume?.track.title, 'Track 1');
				assert.ok(Math.abs((resume?.position ?? 0) - 3.9) < 0.01);
				player.play();
				advance(0.1);
				assert.equal(player.snapshot().trackIndex, 1);
				assert.ok(Math.abs(player.snapshot().position - 3.9) < 0.1);
				assert.equal(player.snapshot().resume, null);
			});

			it('restarts the same track with resetTrack', () => {
				const { player, advance } = playedFor4Seconds('resetTrack');
				player.stop();
				assert.deepEqual(
					{ trackIndex: player.snapshot().resume?.trackIndex, position: player.snapshot().resume?.position },
					{ trackIndex: 1, position: null },
				);
				player.play();
				advance(0.1);
				assert.equal(player.snapshot().trackIndex, 1);
				assert.ok(player.snapshot().position < 0.1);
			});

			it('keeps the play history, so Previous still goes back', () => {
				const { player, advance } = setup({ rules: { stopMode: 'resetTrack' } });
				player.play();
				advance(0.2);
				player.next();
				advance(0.2);
				player.stop();
				player.play();
				advance(0.2);
				player.previous();
				assert.equal(player.snapshot().trackIndex, 0);
			});

			it('follows Stop (Instant) too', () => {
				const { player } = playedFor4Seconds('pause');
				player.stop('instant');
				assert.equal(player.snapshot().resume?.trackIndex, 1);
			});

			it('remembers the position of a track that was still loading', () => {
				const { player } = setup({ rules: { stopMode: 'pause' } });
				player.jumpTo(2);
				player.stop();
				assert.deepEqual(
					{ trackIndex: player.snapshot().resume?.trackIndex, position: player.snapshot().resume?.position },
					{ trackIndex: 2, position: 0 },
				);
			});

			it('announces what it remembers with the idle state', () => {
				const { player, eventsOf } = playedFor4Seconds('resetTrack');
				player.stop();
				const idle = eventsOf('playlist.stateChanged').at(-1);
				assert.equal(idle?.type === 'playlist.stateChanged' && idle.resume?.trackIndex, 1);
			});

			it('forgets when a track is chosen, so the next start is fresh', () => {
				const { player } = playedFor4Seconds('pause');
				player.stop();
				player.jumpTo(0);
				player.stop();
				assert.equal(player.snapshot().resume?.trackIndex, 0);
			});

			it('forgets when the playlist ends by itself', () => {
				const { player, advance } = setup({ tracks: 1, rules: { stopMode: 'pause', playlistLooping: false } });
				player.play();
				advance(11);
				assert.equal(player.state, 'idle');
				assert.equal(player.snapshot().resume, null);
			});

			it('forgets when every track fails', () => {
				const { player, engine, advance } = setup({ tracks: 1, rules: { stopMode: 'pause' } });
				engine.script('/t0', { loadError: 'broken' });
				player.play();
				advance(1);
				assert.equal(player.state, 'idle');
				assert.equal(player.snapshot().resume, null);
			});

			it('forgets on request, and says so', () => {
				const { player, eventsOf } = playedFor4Seconds('pause');
				player.stop();
				player.forget();
				assert.equal(player.snapshot().resume, null);
				const idle = eventsOf('playlist.stateChanged').at(-1);
				assert.equal(idle?.type === 'playlist.stateChanged' && idle.resume, null);
				player.play();
				assert.equal(player.snapshot().trackIndex, 0);
			});

			it('ignores forget while playing', () => {
				const { player, events } = playedFor4Seconds('pause');
				const before = events.length;
				player.forget();
				assert.equal(events.length, before);
				assert.equal(player.state, 'playing');
			});

			it('trims what is remembered when the mode changes, and never brings it back', () => {
				const { player } = playedFor4Seconds('pause');
				player.stop();
				player.setRules({ ...DEFAULT_PLAYBACK_RULES, stopMode: 'resetTrack' });
				assert.equal(player.snapshot().resume?.position, null);
				player.setRules({ ...DEFAULT_PLAYBACK_RULES, stopMode: 'pause' });
				assert.equal(player.snapshot().resume?.position, null);
				player.setRules({ ...DEFAULT_PLAYBACK_RULES, stopMode: 'resetPlaylist' });
				assert.equal(player.snapshot().resume, null);
			});

			it('fades in when resuming with the default transition only', () => {
				const { player, engine, advance } = setup({ rules: { stopMode: 'pause', fadeIn: 2 } });
				player.play('instant');
				advance(2);
				player.stop('instant');
				player.play('instant');
				assert.deepEqual(engine.voices.at(-1)?.gainRamps, []);
				player.stop('instant');
				player.play();
				assert.deepEqual(engine.voices.at(-1)?.gainRamps.at(-1), [1, 2]);
			});
		});
	});

	describe('changing tracks', () => {
		it('replaces the current voice on next', () => {
			const { player, advance, engine, current } = setup();
			player.play();
			advance(1);
			player.next();
			assert.equal(engine.voices[0].stopped, true);
			assert.equal(current().url, '/t1');
			assert.equal(player.state, 'loading');
		});

		it('starts the new track playing when next is pressed while paused', () => {
			const { player, advance, current } = setup();
			player.play();
			advance(1);
			player.pause();
			player.next();
			advance(0.1);
			assert.equal(player.state, 'playing');
			assert.equal(current().playing, true);
		});

		it('stops when next runs past the last track without looping', () => {
			const { player, advance } = setup({ tracks: 2, rules: { playlistLooping: false } });
			player.jumpTo(1);
			advance(1);
			player.next();
			assert.equal(player.state, 'idle');
		});

		it('goes to the previous track within the first 3 seconds', () => {
			const { player, advance, current } = setup();
			player.jumpTo(2);
			advance(0.1 + 2);
			player.previous();
			assert.equal(current().url, '/t1');
		});

		it('restarts the current track after 3 seconds', () => {
			const { player, advance, current, engine } = setup();
			player.jumpTo(2);
			advance(0.1 + 5);
			player.previous();
			assert.equal(engine.voices.length, 1);
			assert.equal(current().position, 0);
		});

		it('restarts and resumes when previous is pressed while paused after 3 seconds', () => {
			const { player, advance, current } = setup();
			player.play();
			advance(5);
			player.pause();
			player.previous();
			assert.equal(player.state, 'playing');
			assert.equal(current().position, 0);
			assert.equal(current().playing, true);
		});

		it('restarts the first track on previous instead of wrapping to the last', () => {
			const { player, current, engine, advance } = setup();
			player.play();
			advance(1);
			player.previous();
			assert.equal(current().url, '/t0');
			assert.equal(current().position, 0);
			assert.equal(engine.voices.length, 1);
		});

		it('jumps to any track, starting the playlist when idle', () => {
			const { player, current, advance } = setup();
			player.jumpTo(1);
			assert.equal(current().url, '/t1');
			advance(1);
			player.jumpTo(2);
			assert.equal(current().url, '/t2');
		});

		it('rejects track indexes that do not exist', () => {
			const { player } = setup();
			for (const index of [-1, 3, 1.5, Number.NaN]) {
				assert.throws(() => player.jumpTo(index), InvalidCommandError);
			}
		});
	});

	describe('playback order', () => {
		/** @param {ReturnType<typeof setup>} context */
		const urlOf = ({ current }) => current().url;

		it('goes back and forward through the history, replaying the same tracks', () => {
			const context = setup({ tracks: 6, rules: { order: 'random' } });
			context.player.play();
			const forward = [1, 2, 3].map(() => {
				context.player.next('instant');
				return urlOf(context);
			});
			context.player.previous('instant');
			context.player.previous('instant');
			assert.equal(urlOf(context), forward[0]);
			context.player.next('instant');
			context.player.next('instant');
			assert.equal(urlOf(context), forward[2]);
		});

		it('never plays the same track twice in a row in random order', () => {
			const context = setup({ tracks: 3, rules: { order: 'random' } });
			context.player.play();
			let last = urlOf(context);
			for (let i = 0; i < 30; i++) {
				context.player.next('instant');
				assert.notEqual(urlOf(context), last);
				last = urlOf(context);
			}
		});

		it('plays every track once per shuffled round', () => {
			const context = setup({ tracks: 5, rules: { order: 'shuffle' } });
			context.player.play();
			const round = [urlOf(context)];
			for (let i = 0; i < 4; i++) {
				context.player.next('instant');
				round.push(urlOf(context));
			}
			assert.equal(new Set(round).size, 5);
		});

		it('starts a fresh history at a chosen track, so previous goes to the track before it in order', () => {
			const context = setup({ tracks: 4 });
			context.player.play();
			context.player.next('instant');
			context.player.jumpTo(3, 'instant');
			context.player.previous('instant');
			assert.equal(urlOf(context), '/t2');
		});

		it('starts a shuffled round with a chosen track, with nothing before it', () => {
			const context = setup({ tracks: 5, rules: { order: 'shuffle' } });
			context.player.play();
			context.player.jumpTo(2, 'instant');
			context.advance(1);
			context.player.previous('instant');
			assert.equal(urlOf(context), '/t2');
			assert.equal(context.current().position, 0);
		});

		it('picks the upcoming track once, however often the crossfade point is asked for', () => {
			/** @param {boolean} ask */
			const nextAfterFirst = (ask) => {
				const context = setup({ tracks: 6, rules: { order: 'random', crossfade: 2 }, seed: 9 });
				context.player.play();
				context.advance(0.1);
				for (let i = 0; ask && i < 5; i++) {
					context.player.snapshot();
				}
				context.player.next('instant');
				return urlOf(context);
			};
			assert.equal(nextAfterFirst(true), nextAfterFirst(false));
		});

		it('crossfades into the same track that next would have played', () => {
			const crossfaded = setup({ tracks: 6, rules: { order: 'shuffle', crossfade: 2 }, seed: 4 });
			crossfaded.player.play();
			crossfaded.advance(0.1 + 8);
			const skipped = setup({ tracks: 6, rules: { order: 'shuffle', crossfade: 2 }, seed: 4 });
			skipped.player.play();
			skipped.advance(0.1);
			skipped.player.next('instant');
			assert.equal(crossfaded.engine.voices[1].url, urlOf(skipped));
		});

		it('refills the history around the current track when the order changes', () => {
			const context = setup({ tracks: 6, rules: { order: 'random' }, seed: 3 });
			context.player.play();
			context.player.next('instant');
			const playing = Number(urlOf(context).slice(2));
			context.player.setRules({ ...DEFAULT_PLAYBACK_RULES, order: 'ordered' });
			assert.equal(urlOf(context), `/t${playing}`, 'the current track keeps playing');
			context.player.next('instant');
			assert.equal(urlOf(context), `/t${(playing + 1) % 6}`);
		});
	});

	describe('track looping', () => {
		it('loops the current track instead of moving on', () => {
			const { player, advance, current, engine, states } = setup({ rules: { trackLooping: true } });
			player.play();
			advance(0.1 + 25);
			assert.equal(current().url, '/t0');
			assert.equal(current().looping, true);
			assert.equal(current().loops, 2);
			assert.equal(engine.voices.length, 1);
			assert.deepEqual(states(), ['loading:0', 'playing:0']);
		});

		it('moves on with next, and the new track loops in turn', () => {
			const { player, advance, current } = setup({ rules: { trackLooping: true } });
			player.play();
			advance(0.1);
			player.next();
			advance(0.1 + 15);
			assert.equal(current().url, '/t1');
			assert.equal(current().loops, 1);
		});

		it('applies a change at once: on makes the playing track loop, off lets it finish and move on', () => {
			const { player, advance, current } = setup();
			player.play();
			advance(0.1 + 5);
			player.setRules({ ...DEFAULT_PLAYBACK_RULES, trackLooping: true });
			advance(10);
			assert.equal(current().url, '/t0');
			player.setRules({ ...DEFAULT_PLAYBACK_RULES, trackLooping: false });
			advance(5);
			assert.equal(current().url, '/t1');
			assert.equal(current().looping, false);
		});

		it('has no crossfade at the loop point, but still crossfades when the track changes', () => {
			const { player, advance, engine, eventsOf } = setup({ rules: { trackLooping: true, crossfade: 2 } });
			player.play();
			advance(0.1);
			assert.equal(player.snapshot().crossfadeFrom, null);
			advance(12);
			assert.ok(eventsOf('playlist.progress').every((event) => event.type === 'playlist.progress' && event.crossfadeFrom === null));
			assert.equal(engine.voices.length, 1, 'no second voice at the loop point');
			player.next();
			assert.equal(engine.voices[1].url, '/t1');
			assert.deepEqual(engine.voices[0].gainRamps.at(-1), [0, 2], 'the looping track crossfades out when the user moves on');
		});

		it('turning looping on during a crossfade makes the incoming track loop', () => {
			const { player, advance, engine } = setup({ rules: { crossfade: 2 } });
			player.play();
			advance(0.1 + 8.5);
			player.setRules({ ...DEFAULT_PLAYBACK_RULES, crossfade: 2, trackLooping: true });
			assert.equal(engine.voices[1].looping, true);
			assert.equal(engine.voices[0].looping, false);
		});
	});

	describe('pause, resume and seek', () => {
		it('freezes the position while paused', () => {
			const { player, advance, current } = setup();
			player.play();
			advance(0.1 + 2);
			player.pause();
			advance(5);
			assert.equal(player.state, 'paused');
			assert.equal(current().position, 2);
			player.resume();
			advance(1);
			assert.equal(player.state, 'playing');
			assert.equal(current().position, 3);
		});

		it('stays paused when the track loads during a pause', () => {
			const { player, advance, eventsOf } = setup();
			player.play();
			player.pause();
			advance(0.1);
			assert.equal(player.state, 'paused');
			const last = eventsOf('playlist.stateChanged').at(-1);
			assert.equal(last?.type === 'playlist.stateChanged' && last.duration, 10);
			player.resume();
			assert.equal(player.state, 'playing');
		});

		it('resumes into loading when the track has not loaded yet', () => {
			const { player, advance } = setup();
			player.play();
			player.pause();
			player.resume();
			assert.equal(player.state, 'loading');
			advance(0.1);
			assert.equal(player.state, 'playing');
		});

		it('ignores pause when idle and resume when not paused', () => {
			const { player, events } = setup();
			player.pause();
			player.resume();
			assert.deepEqual(events, []);
		});

		it('seeks within the track, clamped to its length', () => {
			const { player, advance, current } = setup();
			player.play();
			advance(0.1);
			player.seek(4);
			assert.equal(current().position, 4);
			player.seek(99);
			assert.equal(current().position, 10);
			player.seek(-3);
			assert.equal(current().position, 0);
		});

		it('applies a seek made while loading once the track has loaded', () => {
			const { player, advance, current } = setup();
			player.play();
			player.seek(6);
			advance(0.1);
			assert.equal(current().position, 6);
		});

		it('rejects seeking to something that is not a number', () => {
			const { player } = setup();
			player.play();
			assert.throws(() => player.seek(Number.NaN), InvalidCommandError);
		});
	});

	describe('progress', () => {
		it('reports progress every 250 ms while playing, and stops reporting when paused', () => {
			const { player, advance, eventsOf } = setup();
			player.play();
			advance(0.1 + 1);
			const progress = eventsOf('playlist.progress');
			assert.equal(progress.length, 4);
			assert.deepEqual(progress[0], { type: 'playlist.progress', playlistId: 'Combat', position: 0.25, duration: 10, crossfadeFrom: null });
			player.pause();
			advance(1);
			assert.equal(eventsOf('playlist.progress').length, 4);
		});

		it('reports progress immediately after a seek', () => {
			const { player, advance, eventsOf } = setup();
			player.play();
			advance(0.1);
			player.seek(5);
			assert.deepEqual(eventsOf('playlist.progress').at(-1), { type: 'playlist.progress', playlistId: 'Combat', position: 5, duration: 10, crossfadeFrom: null });
		});
	});

	describe('errors', () => {
		it('reports a failed track and skips to the next', () => {
			const { player, engine, advance, eventsOf, current } = setup();
			engine.script('/t0', { loadError: 'Not found' });
			player.play();
			advance(0.1);
			assert.deepEqual(eventsOf('playlist.error'), [{ type: 'playlist.error', playlistId: 'Combat', trackId: 'Combat/0.mp3', message: 'Not found' }]);
			assert.equal(engine.voices[0].stopped, true);
			assert.equal(current().url, '/t1');
		});

		it('treats a rejected play() as a failed track', () => {
			const { player, engine, advance, current } = setup();
			engine.script('/t0', { playError: 'NotAllowedError' });
			player.play();
			advance(0);
			assert.equal(current().url, '/t1');
		});

		it('stops instead of looping forever when every track fails', () => {
			const { player, engine, advance, eventsOf } = setup();
			for (const url of ['/t0', '/t1', '/t2']) {
				engine.script(url, { loadError: 'broken' });
			}
			player.play();
			advance(10);
			assert.equal(player.state, 'idle');
			assert.equal(eventsOf('playlist.error').length, 3);
			assert.equal(engine.liveVoices.length, 0);
		});

		it('counts consecutive failures only, resetting after a track loads', () => {
			const { player, engine, advance, eventsOf } = setup();
			engine.script('/t0', { loadError: 'broken' });
			engine.script('/t2', { loadError: 'broken' });
			player.play();
			advance(0.1 + 0.1 + 10 + 0.1 + 0.1 + 0.15);
			assert.equal(eventsOf('playlist.error').length, 3);
			assert.equal(player.state, 'playing');
		});

		it('skips tracks this browser cannot play without creating voices for them', () => {
			const { player, engine, eventsOf, current } = setup({ isPlayable: (track) => track.url !== '/t0' });
			player.play();
			assert.deepEqual(engine.voices.map((voice) => voice.url), ['/t1']);
			assert.equal(current().url, '/t1');
			assert.match(/** @type {any} */ (eventsOf('playlist.error')[0]).message, /cannot play mp3/);
		});

		it('stops when no track can be played', () => {
			const { player, engine } = setup({ isPlayable: () => false });
			player.play();
			assert.equal(player.state, 'idle');
			assert.equal(engine.voices.length, 0);
		});
	});

	describe('stale callbacks', () => {
		it('ignores ended and error from a replaced voice, even if the engine still delivers them', () => {
			const { player, engine, advance, states, current, events } = setup();
			engine.script('/t0', { leaky: true, duration: 2 });
			player.play();
			advance(1);
			player.next();
			const before = states().length;
			advance(2);
			engine.voices[0].fail('late error');
			advance(0.1);
			assert.equal(current().url, '/t1');
			assert.deepEqual(states().slice(before), ['playing:1']);
			assert.deepEqual(events.filter((event) => event.type === 'playlist.error'), []);
		});

		it('ignores callbacks from a voice that was stopped', () => {
			const { player, engine, advance, events } = setup();
			engine.script('/t0', { leaky: true, duration: 2 });
			player.play();
			player.stop();
			const before = events.length;
			advance(5);
			assert.equal(events.length, before);
			assert.equal(player.state, 'idle');
		});
	});

	describe('renamed tracks', () => {
		it('takes a changed playlist and announces the current track with its new title', () => {
			const { player, advance, eventsOf } = setup();
			player.play();
			advance(0.1);
			const renamed = playlistOf(3);
			renamed.tracks[0] = { ...renamed.tracks[0], title: 'Battle' };
			player.setPlaylist(renamed);
			const last = eventsOf('playlist.stateChanged').at(-1);
			assert.equal(last?.type === 'playlist.stateChanged' && last.track?.title, 'Battle');
			assert.equal(player.snapshot().track?.title, 'Battle');
		});

		it('says nothing while idle', () => {
			const { player, eventsOf } = setup();
			player.setPlaylist(playlistOf(3));
			assert.deepEqual(eventsOf('playlist.stateChanged'), []);
		});
	});

	describe('gain', () => {
		it('plays each track at the playlist gain times the track gain', () => {
			const { player, engine } = setup({ gains: { gain: 0.5, trackGains: [1, 2] } });
			player.play();
			player.next('instant');
			assert.deepEqual(engine.voices.map((voice) => voice.gain), [0.5, 1]);
		});

		it('applies a new playlist gain to the current voice and to voices still fading out, with their own track gains', () => {
			const { player, engine, advance } = setup({ rules: { crossfade: 2 }, gains: { trackGains: [1, 3] } });
			player.play();
			advance(1);
			player.next();
			player.setGain(0.5);
			const [old, fresh] = engine.voices;
			assert.deepEqual([old.gain, fresh.gain], [0.5, 1.5]);
			assert.equal(old.stopped, false, 'still fading out');
			assert.deepEqual(old.gainRamps, [[0, 2]], 'the gain change does not touch the fade');
		});

		it('starts later tracks at the new gain', () => {
			const { player, engine } = setup();
			player.setGain(2);
			player.play();
			assert.equal(engine.voices[0].gain, 2);
		});

		it('leaves stopped voices alone', () => {
			const { player, engine } = setup();
			player.play();
			player.stop('instant');
			player.setGain(0.25);
			assert.equal(engine.voices[0].gain, 1);
		});
	});

	describe('crossfade', () => {
		/**
		 * Plays the first track until it has loaded, at clock time 0.1 s.
		 * @param {Parameters<typeof setup>[0]} [options]
		 */
		function playing(options) {
			const context = setup({ rules: { crossfade: 2 }, ...options });
			context.player.play();
			context.advance(0.1);
			return context;
		}

		it('reports where the crossfade will start, in snapshots, state and progress events', () => {
			const { player, advance, events } = playing();
			assert.equal(player.snapshot().crossfadeFrom, 8);
			const playingEvent = events.findLast((event) => event.type === 'playlist.stateChanged');
			assert.equal(playingEvent?.type === 'playlist.stateChanged' && playingEvent.crossfadeFrom, 8);
			advance(0.25);
			const progress = events.findLast((event) => event.type === 'playlist.progress');
			assert.equal(progress?.type === 'playlist.progress' && progress.crossfadeFrom, 8);
		});

		it('reports no crossfade point without a crossfade or before the duration is known', () => {
			const { player } = setup({ rules: { crossfade: 2 } });
			player.play();
			assert.equal(player.snapshot().crossfadeFrom, null, 'still loading');
			const plain = playing({ rules: { crossfade: 0 } });
			assert.equal(plain.player.snapshot().crossfadeFrom, null);
		});

		it('reports the shortened overlap of a short track', () => {
			const context = setup({ rules: { crossfade: 2 } });
			context.engine.script('/t0', { duration: 3 });
			context.player.play();
			context.advance(0.1);
			assert.equal(context.player.snapshot().crossfadeFrom, 1.5);
		});

		it('reports a new crossfade point at once when the setting changes, even while paused', () => {
			const { player, events } = playing();
			player.pause();
			player.setRules({ ...DEFAULT_PLAYBACK_RULES, crossfade: 4 });
			const progress = events.at(-1);
			assert.equal(progress?.type === 'playlist.progress' && progress.crossfadeFrom, 6);
		});

		it('starts the next track before the current one ends, fading across over the crossfade', () => {
			const { engine, advance, player } = playing();
			advance(7.99);
			assert.equal(engine.voices.length, 1);
			advance(0.01);
			const [old, fresh] = engine.voices;
			assert.equal(fresh?.url, '/t1');
			assert.deepEqual(old.gainRamps, [[0, 2]]);
			assert.deepEqual(fresh.gainRamps, [[0, 0], [1, 2]]);
			assert.equal(player.snapshot().trackIndex, 1);
			assert.equal(old.stopped, false, 'the old track plays out under the new one');
			advance(3.1);
			assert.equal(old.stopped, true);
		});

		it('plans again after a seek', () => {
			const { engine, advance, player } = playing();
			player.seek(5);
			advance(2.99);
			assert.equal(engine.voices.length, 1);
			advance(0.01);
			assert.equal(engine.voices.length, 2);
		});

		it('seeks past the crossfade point only to the point itself, which starts the whole crossfade at once', () => {
			const { engine, player, events } = playing();
			player.seek(9.5);
			const [old, fresh] = engine.voices;
			assert.equal(old.position, 8);
			assert.deepEqual(old.gainRamps, [[0, 2]], 'the full overlap, not the half second that was asked for');
			assert.deepEqual(fresh.gainRamps, [[0, 0], [1, 2]]);
			const progress = events.filter((event) => event.type === 'playlist.progress');
			assert.ok(progress.some((event) => event.type === 'playlist.progress' && event.position === 8), 'reports where it landed');
		});

		it('clamps a seek made while loading once the track has loaded', () => {
			const { engine, player, advance } = setup({ rules: { crossfade: 2 } });
			player.play();
			player.seek(9.5);
			advance(0.1);
			assert.equal(engine.voices[0].position, 8);
			assert.equal(engine.voices.length, 2, 'the crossfade starts from there');
		});

		it('lets a seek before the crossfade point through, and does not clamp without a crossfade', () => {
			const before = playing();
			before.player.seek(7.5);
			assert.equal(before.engine.voices[0].position, 7.5);
			assert.equal(before.engine.voices.length, 1);

			const plain = playing({ rules: { crossfade: 0 } });
			plain.player.seek(9.5);
			assert.equal(plain.engine.voices[0].position, 9.5);
		});

		it('waits while paused and plans again on resume', () => {
			const { engine, advance, player } = playing();
			advance(3);
			player.pause();
			advance(20);
			assert.equal(engine.voices.length, 1);
			player.resume();
			advance(4.99);
			assert.equal(engine.voices.length, 1);
			advance(0.01);
			assert.equal(engine.voices.length, 2);
		});

		it('plans again when the crossfade setting changes while playing', () => {
			const { engine, advance, player } = playing({ rules: { crossfade: 0 } });
			advance(3);
			player.setRules({ ...DEFAULT_PLAYBACK_RULES, crossfade: 4 });
			advance(2.99);
			assert.equal(engine.voices.length, 1);
			advance(0.01);
			assert.equal(engine.voices.length, 2);
		});

		it('uses at most half of a short track', () => {
			const context = setup({ rules: { crossfade: 2 } });
			context.engine.script('/t0', { duration: 3 });
			context.player.play();
			context.advance(0.1);
			context.advance(1.5);
			const [old, fresh] = context.engine.voices;
			assert.deepEqual(old.gainRamps, [[0, 1.5]]);
			assert.deepEqual(fresh.gainRamps, [[0, 0], [1, 1.5]]);
		});

		it('ignores the end of a track that was replaced', () => {
			const { engine, advance, player } = playing();
			advance(5);
			player.next('instant');
			advance(3.5);
			assert.equal(engine.voices.length, 2, 'no crossfade from the old track\'s end');
			advance(5);
			assert.equal(engine.voices.length, 3, 'the new track crossfades at its own end');
		});

		it('ignores a planned crossfade once the track was replaced, even while the new one is still loading', () => {
			const { engine, advance, player } = playing();
			engine.script('/t2', { loadDelay: 1 });
			advance(7.8);
			player.jumpTo(2, 'instant');
			advance(0.5);
			assert.deepEqual(engine.voices.map((voice) => voice.url), ['/t0', '/t2']);
		});

		it('crossfades a single looping track into a new start of itself', () => {
			const { engine, advance } = playing({ tracks: 1 });
			advance(8);
			assert.deepEqual(engine.voices.map((voice) => voice.url), ['/t0', '/t0']);
		});

		it('crossfades manual changes too, but stops a paused track at once', () => {
			const { engine, advance, player } = playing();
			advance(1);
			player.next();
			assert.deepEqual(engine.voices[0].gainRamps, [[0, 2]]);
			advance(0.1);
			player.pause();
			player.next();
			assert.equal(engine.voices[1].stopped, true);
		});

		it('cuts both tracks when stopped during a crossfade, as long as there is no fade-out', () => {
			const { engine, advance, player } = playing();
			advance(8);
			assert.equal(engine.liveVoices.length, 2);
			player.stop();
			assert.equal(engine.liveVoices.length, 0);
		});

		it('stops the fading-out track when paused during a crossfade', () => {
			const { engine, advance, player } = playing();
			advance(8);
			player.pause();
			const [old, fresh] = engine.voices;
			assert.equal(old.stopped, true);
			assert.equal(fresh.stopped, false);
			assert.equal(fresh.playing, false);
			player.resume();
			assert.equal(engine.liveVoices.length, 1);
		});
	});

	describe('fade in and fade out', () => {
		it('fades in when the playlist starts, also from a jump while idle', () => {
			const { player, engine } = setup({ rules: { fadeIn: 3 } });
			player.play();
			assert.deepEqual(engine.voices[0].gainRamps, [[0, 0], [1, 3]]);
			player.stop('instant');
			player.jumpTo(1);
			assert.deepEqual(engine.voices[1].gainRamps, [[0, 0], [1, 3]]);
		});

		it('does not fade in on an instant start', () => {
			const { player, engine } = setup({ rules: { fadeIn: 3 } });
			player.play('instant');
			assert.deepEqual(engine.voices[0].gainRamps, []);
		});

		it('fades out on stop, but never for longer than the track has left', () => {
			const { player, engine, advance } = setup({ rules: { fadeOut: 5 } });
			player.play();
			advance(8.1);
			player.stop();
			assert.equal(player.state, 'idle');
			assert.deepEqual(engine.voices[0].gainRamps, [[0, 2]]);
		});

		it('fades out from wherever a fade-in had got to', () => {
			const { player, engine, advance } = setup({ rules: { fadeIn: 4, fadeOut: 2 } });
			player.play();
			advance(1.1);
			player.stop();
			assert.deepEqual(engine.voices[0].gainRamps, [[0, 0], [1, 4], [0, 2]]);
		});

		it('lets a track fading out from a crossfade carry on when stopped, and fades the new one out', () => {
			const { player, engine, advance } = setup({ rules: { crossfade: 2, fadeOut: 3 } });
			player.play();
			advance(8.2);
			const [old, fresh] = engine.voices;
			player.stop();
			assert.equal(old.stopped, false);
			assert.deepEqual(old.gainRamps, [[0, 2]], 'its crossfade is left as it was');
			assert.deepEqual(fresh.gainRamps.at(-1), [0, 3]);
			advance(4.1);
			assert.equal(engine.liveVoices.length, 0);
		});

		it('leaves a fade-out alone when the playlist is played again', () => {
			const { player, engine, advance } = setup({ rules: { fadeIn: 1, fadeOut: 3 } });
			player.play();
			advance(2);
			player.stop();
			player.play();
			const [old, fresh] = engine.voices;
			assert.equal(old.stopped, false);
			assert.deepEqual(fresh.gainRamps, [[0, 0], [1, 1]]);
			advance(4.1);
			assert.equal(old.stopped, true);
			assert.equal(fresh.stopped, false);
		});

		it('cuts every fade on an instant stop or start', () => {
			const { player, engine, advance } = setup({ rules: { fadeOut: 3 } });
			player.play();
			advance(2);
			player.stop();
			player.play('instant');
			assert.equal(engine.voices[0].stopped, true);
			player.stop('instant');
			assert.equal(engine.liveVoices.length, 0);
		});

		it('ends a fade-in when paused, so it resumes at full volume', () => {
			const { player, engine, advance } = setup({ rules: { fadeIn: 4 } });
			player.play();
			advance(1.1);
			player.pause();
			assert.deepEqual(engine.voices[0].gainRamps.at(-1), [1, 0]);
			player.resume();
			assert.deepEqual(engine.voices[0].gainRamps.at(-1), [1, 0], 'resuming does not fade');
		});
	});

	describe('fades (future rules)', () => {
		it('uses new rules from the next change of track', () => {
			const { player, engine, advance } = setup();
			player.play();
			advance(1);
			player.setRules({ ...DEFAULT_PLAYBACK_RULES, crossfade: 3 });
			player.next();
			assert.deepEqual(engine.voices[0].gainRamps, [[0, 3]]);
		});

		it('fades the old track out and the new one in on a default change', () => {
			const { player, engine, advance } = setup({ rules: { crossfade: 2 } });
			player.play();
			advance(1);
			player.next();
			const [old, fresh] = engine.voices;
			assert.deepEqual(old.gainRamps, [[0, 2]]);
			assert.deepEqual(fresh.gainRamps, [[0, 0], [1, 2]]);
			assert.equal(old.stopped, false);
			advance(3);
			assert.equal(old.stopped, true);
		});

		it('cuts fading voices immediately on an instant command', () => {
			const { player, engine, advance } = setup({ rules: { crossfade: 2 } });
			player.play();
			advance(1);
			player.next();
			player.next('instant');
			assert.equal(engine.liveVoicesOn('music').length, 1);
		});

		it('keeps at most 4 voices fading out', () => {
			const { player, engine, advance } = setup({ tracks: 3, rules: { crossfade: 5 } });
			// Long enough that no track reaches its own crossfade during the test.
			for (const url of ['/t0', '/t1', '/t2']) {
				engine.script(url, { duration: 60 });
			}
			player.play();
			for (let i = 0; i < 8; i++) {
				advance(0.2);
				player.next();
			}
			assert.equal(engine.liveVoicesOn('music').length, 5);
			advance(6);
			assert.equal(engine.liveVoicesOn('music').length, 1);
		});

		it('fades out on a default stop and cuts on an instant stop', () => {
			const faded = setup({ rules: { fadeOut: 2 } });
			faded.player.play();
			faded.advance(1);
			faded.player.stop();
			assert.equal(faded.player.state, 'idle');
			assert.deepEqual(faded.engine.voices[0].gainRamps, [[0, 2]]);
			assert.equal(faded.engine.liveVoices.length, 1);
			faded.advance(3);
			assert.equal(faded.engine.liveVoices.length, 0);

			const cut = setup({ rules: { fadeOut: 2 } });
			cut.player.play();
			cut.advance(1);
			cut.player.stop('instant');
			assert.equal(cut.engine.liveVoices.length, 0);
		});

		it('stops a track that fails during a crossfade at once instead of fading it', () => {
			const { player, engine, advance } = setup({ rules: { crossfade: 2 } });
			engine.script('/t1', { loadError: 'broken' });
			player.play();
			advance(0.1 + 8);
			assert.equal(engine.voices[1].url, '/t1');
			advance(0.1);
			assert.equal(engine.voices[1].stopped, true);
			assert.equal(engine.voices[2].url, '/t2');
			assert.equal(engine.voices[0].stopped, false, 'the first track still fades out');
			advance(3);
			assert.deepEqual(engine.liveVoicesOn('music').map((voice) => voice.url), ['/t2']);
		});

		it('does not fade voices that are not audible', () => {
			const { player, engine, advance } = setup({ rules: { crossfade: 2 } });
			player.play();
			advance(1);
			player.pause();
			player.next();
			assert.equal(engine.voices[0].stopped, true);
		});
	});

	describe('invariant under random commands', () => {
		it('keeps one audible voice at most, and leaves nothing behind once stopped', () => {
			let seed = 12345;
			const random = () => {
				seed = (seed * 1103515245 + 12345) % 2 ** 31;
				return seed / 2 ** 31;
			};
			const transitions = /** @type {const} */ (['default', 'instant']);
			const pick = (/** @type {readonly any[]} */ items) => items[Math.floor(random() * items.length)];

			const orders = /** @type {const} */ (['ordered', 'random', 'shuffle']);
			const stopModes = /** @type {const} */ (['pause', 'resetTrack', 'resetPlaylist']);
			for (let run = 0; run < 400; run++) {
				const fades = run % 2 === 0 ? {} : { crossfade: 1.5, fadeOut: 1, fadeIn: 0.5 };
				const rules = { ...fades, order: orders[run % 3], trackLooping: run % 5 === 1, stopMode: stopModes[Math.floor(run / 3) % 3] };
				const { player, engine, advance, clock } = setup({ tracks: 1 + (run % 4), rules, seed: run });
				if (run % 5 === 0) {
					engine.script('/t1', { loadError: 'broken' });
				}
				if (run % 7 === 0) {
					engine.script('/t0', { leaky: true, duration: 1 });
				}
				const commands = [
					() => player.play(pick(transitions)),
					() => player.stop(pick(transitions)),
					() => player.next(pick(transitions)),
					() => player.previous(pick(transitions)),
					() => player.jumpTo(Math.floor(random() * (1 + (run % 4))), pick(transitions)),
					() => player.seek(random() * 12),
					() => player.pause(),
					() => player.resume(),
					() => advance(random() * 4),
				];
				for (let step = 0; step < 30; step++) {
					pick(commands)();
				}
				advance(10);
				const live = engine.liveVoicesOn('music');
				// A voice whose last fade went to silence is on its way out; with crossfades one can overlap the current one.
				const audible = live.filter((voice) => voice.gainRamps.at(-1)?.[0] !== 0);
				if (player.state === 'idle') {
					assert.equal(live.length, 0, `run ${run}: idle with ${live.length} live voices`);
					assert.equal(clock.pendingTimerCount, 0, `run ${run}: idle with timers left`);
				} else {
					assert.ok(audible.length <= 1, `run ${run}: ${player.state} with ${audible.length} audible voices`);
					assert.ok(live.length <= 5, `run ${run}: ${live.length} live voices`);
				}

				player.stop('default');
				advance(5);
				assert.equal(engine.liveVoicesOn('music').length, 0, `run ${run}: voices left after stopping`);
				assert.equal(clock.pendingTimerCount, 0, `run ${run}: timers left after stopping`);
			}
		});
	});
});
