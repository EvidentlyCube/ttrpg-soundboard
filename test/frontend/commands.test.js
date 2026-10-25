import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand } from '../../public/app/logic/commands.js';
import { InvalidCommandError } from '../../public/app/logic/errors.js';

describe('validateCommand', () => {
	it('accepts every well-formed command', () => {
		const commands = [
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
			{ type: 'volume.set', bus: 'music', value: 0.5 },
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
		];
		for (const [command, message] of cases) {
			assert.throws(() => validateCommand(command), (error) => error instanceof InvalidCommandError && message.test(error.message), JSON.stringify(command));
		}
	});
});
