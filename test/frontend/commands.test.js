import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand } from '../../public/app/logic/commands.js';
import { InvalidCommandError } from '../../public/app/logic/errors.js';

describe('validateCommand', () => {
	it('accepts every well-formed command', () => {
		const commands = [
			{ type: 'panic.stop' },
			{ type: 'sound.play', soundId: 'a' },
			{ type: 'sound.stop', soundId: 'a' },
			{ type: 'playlist.toggle', playlistId: 'p' },
			{ type: 'playlist.play', playlistId: 'p' },
			{ type: 'playlist.play', playlistId: 'p', transition: 'instant' },
			{ type: 'playlist.stop', playlistId: 'p', transition: 'default' },
			{ type: 'playlist.next', playlistId: 'p' },
			{ type: 'playlist.previous', playlistId: 'p' },
			{ type: 'playlist.jump', playlistId: 'p', trackIndex: 2 },
			{ type: 'playlist.seek', playlistId: 'p', seconds: 12.5 },
			{ type: 'playlist.pause', playlistId: 'p' },
			{ type: 'playlist.resume', playlistId: 'p' },
			{ type: 'playlist.forget', playlistId: 'p' },
			{ type: 'volume.set', bus: 'music', value: 0.5 },
			{ type: 'sound.customize', soundId: 'a', title: 'Boom' },
			{ type: 'sound.customize', soundId: 'a', gain: 2 },
			{ type: 'sound.customize', soundId: 'a', title: 'Boom', gain: 0 },
			{ type: 'sound.customize', soundId: 'a', startAt: 0.5, endAt: 1 },
			{ type: 'sound.customize', soundId: 'a', endAt: null },
			{ type: 'sound.customize', soundId: 'a', fadeIn: 0.5, fadeOut: 1 },
			{ type: 'playlist.customize', playlistId: 'p', title: 'Fight' },
			{ type: 'playlist.customize', playlistId: 'p', gain: 1.5 },
			{ type: 'playlist.customize', playlistId: 'p', crossfade: 2 },
			{ type: 'playlist.customize', playlistId: 'p', fadeIn: 1, fadeOut: 2 },
			{ type: 'playlist.customize', playlistId: 'p', stopMode: 'pause' },
			{ type: 'track.customize', trackId: 'p/1.mp3', title: 'Battle' },
			{ type: 'track.customize', trackId: 'p/1.mp3', gain: 0.5 },
		];
		for (const command of commands) {
			assert.equal(validateCommand(command), command, JSON.stringify(command));
		}
	});

	it('rejects malformed commands with a reason', () => {
		/** @type {[unknown, RegExp][]} */
		const cases = [
			[null, /must be an object/],
			['sound.play', /must be an object/],
			[{ type: 'sound.explode', soundId: 'a' }, /Unknown command "sound.explode"/],
			[{ type: 'sound.play' }, /"soundId" must be a string/],
			[{ type: 'playlist.next', playlistId: 3 }, /"playlistId" must be a string/],
			[{ type: 'playlist.play', playlistId: 'p', transition: 'fade' }, /"transition" must be "default" or "instant"/],
			[{ type: 'playlist.jump', playlistId: 'p' }, /"trackIndex" must be a number/],
			[{ type: 'playlist.seek', playlistId: 'p', seconds: '3' }, /"seconds" must be a number/],
			[{ type: 'volume.set', bus: 'music' }, /"value" must be a number/],
			[{ type: 'volume.set', value: 1 }, /"bus" must be a string/],
			[{ type: 'sound.customize', soundId: 'a', title: 5 }, /"title" must be a string/],
			[{ type: 'sound.customize', soundId: 'a', gain: '2' }, /"gain" must be a number/],
			[{ type: 'sound.customize', soundId: 'a' }, /needs "title" or "gain"/],
			[{ type: 'sound.customize', soundId: 'a', startAt: null }, /"startAt" must be a number/],
			[{ type: 'sound.customize', soundId: 'a', endAt: '1' }, /"endAt" must be a number or null/],
			[{ type: 'sound.customize', soundId: 'a', fadeOut: '1' }, /"fadeOut" must be a number/],
			[{ type: 'playlist.customize', playlistId: 'p', gain: null }, /"gain" must be a number/],
			[{ type: 'playlist.customize', playlistId: 'p', crossfade: '2' }, /"crossfade" must be a number/],
			[{ type: 'playlist.customize', playlistId: 'p', fadeOut: '1' }, /"fadeOut" must be a number/],
			[{ type: 'playlist.customize', playlistId: 'p', stopMode: 1 }, /"stopMode" must be a string/],
			[{ type: 'track.customize', trackId: 'p/1.mp3' }, /needs "title"/],
			[{ type: 'track.customize', trackId: 'p/1.mp3', gain: '1' }, /"gain" must be a number/],
			[{ type: 'track.customize', title: 'X' }, /"trackId" must be a string/],
			[{ type: 'playlist.customize', playlistId: 'p' }, /needs "title" or "gain" or "crossfade" or "fadeIn" or "fadeOut"/],
			[{ type: 'playlist.customize', soundId: 'p', gain: 1 }, /"playlistId" must be a string/],
		];
		for (const [command, message] of cases) {
			assert.throws(() => validateCommand(command), (error) => error instanceof InvalidCommandError && message.test(error.message), JSON.stringify(command));
		}
	});
});
