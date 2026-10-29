import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NoPlayerError, NotRelayableError, RemoteRelay } from '../../../src/remote/remote-relay.js';

/** A stream's `send`, recording what it was given. */
function recorder() {
	/** @type {unknown[]} */
	const messages = [];
	return { messages, send: (/** @type {unknown} */ message) => messages.push(message) };
}

describe('RemoteRelay', () => {
	describe('remotes', () => {
		it('tells a new remote that no player is connected', () => {
			const relay = new RemoteRelay();
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.deepEqual(remote.messages, [{ type: 'remote.player', connected: false }]);
		});

		it('gives a new remote the host and the latest state', () => {
			const relay = new RemoteRelay();
			const player = relay.attachPlayer(recorder().send);
			relay.updateState(player.id, { panic: 'fade' });
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.deepEqual(remote.messages, [
				{ type: 'remote.player', connected: true },
				{ type: 'remote.state', state: { panic: 'fade' } },
			]);
		});

		it('sends every state to every remote', () => {
			const relay = new RemoteRelay();
			const player = relay.attachPlayer(recorder().send);
			const first = recorder();
			const second = recorder();
			relay.attachRemote(first.send);
			relay.attachRemote(second.send);
			relay.updateState(player.id, { panic: 'now' });
			assert.deepEqual(first.messages.at(-1), { type: 'remote.state', state: { panic: 'now' } });
			assert.deepEqual(second.messages.at(-1), { type: 'remote.state', state: { panic: 'now' } });
		});

		it('stops sending to a remote that detached', () => {
			const relay = new RemoteRelay();
			const player = relay.attachPlayer(recorder().send);
			const remote = recorder();
			const detach = relay.attachRemote(remote.send);
			detach();
			relay.updateState(player.id, { panic: 'now' });
			assert.equal(remote.messages.length, 1);
		});
	});

	describe('players', () => {
		it('makes a new player the host and tells it to send its state', () => {
			const relay = new RemoteRelay();
			const first = recorder();
			relay.attachPlayer(first.send);
			assert.deepEqual(first.messages, [{ type: 'remote.host' }]);
		});

		it('makes the newest player the host, and the older one gets no more commands', () => {
			const relay = new RemoteRelay();
			const older = recorder();
			const newer = recorder();
			relay.attachPlayer(older.send);
			relay.attachPlayer(newer.send);
			relay.sendCommand({ type: 'panic.stop' });
			assert.deepEqual(newer.messages.at(-1), { type: 'command', command: { type: 'panic.stop' } });
			assert.deepEqual(older.messages, [{ type: 'remote.host' }]);
		});

		it('forgets the old state when the host changes, until the new host sends its own', () => {
			const relay = new RemoteRelay();
			const older = relay.attachPlayer(recorder().send);
			const remote = recorder();
			relay.attachRemote(remote.send);
			relay.updateState(older.id, { panic: 'now' });
			const newer = relay.attachPlayer(recorder().send);
			assert.deepEqual(remote.messages.at(-1), { type: 'remote.state', state: null });
			relay.updateState(newer.id, { panic: 'fade' });
			assert.deepEqual(remote.messages.at(-1), { type: 'remote.state', state: { panic: 'fade' } });
		});

		it('ignores a state from a player that is not the host', () => {
			const relay = new RemoteRelay();
			const older = relay.attachPlayer(recorder().send);
			relay.attachPlayer(recorder().send);
			const remote = recorder();
			relay.attachRemote(remote.send);
			const before = remote.messages.length;
			assert.equal(relay.updateState(older.id, { panic: 'now' }), false);
			assert.equal(remote.messages.length, before);
		});

		it('hands the host role back to the previous player when the host goes away', () => {
			const relay = new RemoteRelay();
			const older = recorder();
			relay.attachPlayer(older.send);
			const newer = relay.attachPlayer(recorder().send);
			newer.detach();
			assert.deepEqual(older.messages, [{ type: 'remote.host' }, { type: 'remote.host' }]);
			relay.sendCommand({ type: 'panic.stop' });
			assert.deepEqual(older.messages.at(-1), { type: 'command', command: { type: 'panic.stop' } });
		});

		it('tells the remotes when the last player goes away', () => {
			const relay = new RemoteRelay();
			const player = relay.attachPlayer(recorder().send);
			const remote = recorder();
			relay.attachRemote(remote.send);
			relay.updateState(player.id, { panic: 'fade' });
			player.detach();
			assert.deepEqual(remote.messages.slice(-2), [
				{ type: 'remote.player', connected: false },
				{ type: 'remote.state', state: null },
			]);
		});

		it('detaching twice is harmless', () => {
			const relay = new RemoteRelay();
			const first = relay.attachPlayer(recorder().send);
			const second = recorder();
			relay.attachPlayer(second.send);
			first.detach();
			first.detach();
			relay.sendCommand({ type: 'panic.stop' });
			assert.equal(second.messages.length, 2);
		});
	});

	describe('commands', () => {
		it('passes the allowed commands to the host', () => {
			const relay = new RemoteRelay();
			const player = recorder();
			relay.attachPlayer(player.send);
			const commands = [
				{ type: 'panic.stop' },
				{ type: 'sound.play', soundId: 'Boom.mp3' },
				{ type: 'playlist.toggle', playlistId: 'Combat' },
				{ type: 'playlist.pause', playlistId: 'Combat' },
				{ type: 'playlist.resume', playlistId: 'Combat' },
				{ type: 'playlist.next', playlistId: 'Combat' },
				{ type: 'playlist.previous', playlistId: 'Combat' },
			];
			for (const command of commands) {
				relay.sendCommand(command);
			}
			assert.deepEqual(player.messages.slice(1), commands.map((command) => ({ type: 'command', command })));
		});

		it('refuses a command that could change the library or the settings', () => {
			const relay = new RemoteRelay();
			const player = recorder();
			relay.attachPlayer(player.send);
			for (const command of [
				{ type: 'sound.customize', soundId: 'Boom.mp3', title: 'x' },
				{ type: 'volume.set', bus: 'master', value: 0 },
				{ type: 'playlist.forget', playlistId: 'Combat' },
				{ type: 'nonsense' },
				{},
				null,
				'panic.stop',
				['panic.stop'],
			]) {
				assert.throws(() => relay.sendCommand(command), NotRelayableError);
			}
			assert.equal(player.messages.length, 1);
		});

		it('refuses an allowed command while no player is connected', () => {
			const relay = new RemoteRelay();
			assert.throws(() => relay.sendCommand({ type: 'panic.stop' }), NoPlayerError);
		});

		it('checks what the command is before whether a player is there', () => {
			const relay = new RemoteRelay();
			assert.throws(() => relay.sendCommand({ type: 'volume.set' }), NotRelayableError);
		});
	});
});
