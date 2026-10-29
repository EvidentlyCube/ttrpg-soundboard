import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NoHostError, NotRelayableError, RemoteRelay } from '../../../src/remote/remote-relay.js';

/** A stream's `send`, recording what it was given. */
function recorder() {
	/** @type {unknown[]} */
	const messages = [];
	return { messages, send: (/** @type {unknown} */ message) => messages.push(message) };
}

describe('RemoteRelay', () => {
	describe('remotes', () => {
		it('tells a new remote that no host is connected', () => {
			const relay = new RemoteRelay();
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.deepEqual(remote.messages, [{ type: 'remote.host', connected: false }]);
		});

		it('gives a new remote the host and the latest state', () => {
			const relay = new RemoteRelay();
			const host = relay.attachHost(recorder().send);
			assert.ok(host);
			relay.updateState(host.id, { panic: 'fade' });
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.deepEqual(remote.messages, [
				{ type: 'remote.host', connected: true },
				{ type: 'remote.state', state: { panic: 'fade' } },
			]);
		});

		it('sends every state to every remote', () => {
			const relay = new RemoteRelay();
			const host = relay.attachHost(recorder().send);
			assert.ok(host);
			const first = recorder();
			const second = recorder();
			relay.attachRemote(first.send);
			relay.attachRemote(second.send);
			relay.updateState(host.id, { panic: 'now' });
			assert.deepEqual(first.messages.at(-1), { type: 'remote.state', state: { panic: 'now' } });
			assert.deepEqual(second.messages.at(-1), { type: 'remote.state', state: { panic: 'now' } });
		});

		it('tells the remotes already attached when a host appears', () => {
			const relay = new RemoteRelay();
			const remote = recorder();
			relay.attachRemote(remote.send);
			relay.attachHost(recorder().send);
			assert.deepEqual(remote.messages.at(-1), { type: 'remote.host', connected: true });
		});

		it('stops sending to a remote that detached', () => {
			const relay = new RemoteRelay();
			const host = relay.attachHost(recorder().send);
			assert.ok(host);
			const remote = recorder();
			const detach = relay.attachRemote(remote.send);
			detach();
			relay.updateState(host.id, { panic: 'now' });
			assert.equal(remote.messages.length, 1);
		});
	});

	describe('hosts', () => {
		it('keeps the first host: a page that asks later is not the host and gets nothing', () => {
			const relay = new RemoteRelay();
			const first = recorder();
			const later = recorder();
			assert.ok(relay.attachHost(first.send));
			assert.equal(relay.attachHost(later.send), null);
			relay.sendCommand({ type: 'panic.stop' });
			assert.deepEqual(first.messages, [{ type: 'command', command: { type: 'panic.stop' } }]);
			assert.deepEqual(later.messages, []);
		});

		it('does not make the page that asked later the host when the first one goes away', () => {
			const relay = new RemoteRelay();
			const first = relay.attachHost(recorder().send);
			const later = recorder();
			relay.attachHost(later.send);
			assert.ok(first);
			first.detach();
			assert.throws(() => relay.sendCommand({ type: 'panic.stop' }), NoHostError);
			assert.deepEqual(later.messages, []);
		});

		it('lets a page that asks after the host went away become the host', () => {
			const relay = new RemoteRelay();
			const first = relay.attachHost(recorder().send);
			assert.ok(first);
			first.detach();
			const next = recorder();
			assert.ok(relay.attachHost(next.send));
			relay.sendCommand({ type: 'panic.stop' });
			assert.equal(next.messages.length, 1);
		});

		it('tells the remotes when the host goes away, and forgets its state', () => {
			const relay = new RemoteRelay();
			const host = relay.attachHost(recorder().send);
			assert.ok(host);
			const remote = recorder();
			relay.attachRemote(remote.send);
			relay.updateState(host.id, { panic: 'fade' });
			host.detach();
			assert.deepEqual(remote.messages.slice(-2), [
				{ type: 'remote.host', connected: false },
				{ type: 'remote.state', state: null },
			]);
			const late = recorder();
			relay.attachRemote(late.send);
			assert.deepEqual(late.messages, [{ type: 'remote.host', connected: false }]);
		});

		it('ignores a state sent after the host went away', () => {
			const relay = new RemoteRelay();
			const host = relay.attachHost(recorder().send);
			assert.ok(host);
			host.detach();
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.equal(relay.updateState(host.id, { panic: 'now' }), false);
			assert.equal(remote.messages.length, 1);
		});

		it('detaching twice does not touch a later host', () => {
			const relay = new RemoteRelay();
			const first = relay.attachHost(recorder().send);
			assert.ok(first);
			first.detach();
			const next = recorder();
			relay.attachHost(next.send);
			first.detach();
			relay.sendCommand({ type: 'panic.stop' });
			assert.equal(next.messages.length, 1);
		});
	});

	describe('commands', () => {
		it('passes the allowed commands to the host', () => {
			const relay = new RemoteRelay();
			const host = recorder();
			relay.attachHost(host.send);
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
			assert.deepEqual(host.messages, commands.map((command) => ({ type: 'command', command })));
		});

		it('refuses a command that could change the library or the settings', () => {
			const relay = new RemoteRelay();
			const host = recorder();
			relay.attachHost(host.send);
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
			assert.equal(host.messages.length, 0);
		});

		it('refuses an allowed command while no host is connected', () => {
			const relay = new RemoteRelay();
			assert.throws(() => relay.sendCommand({ type: 'panic.stop' }), NoHostError);
		});

		it('checks what the command is before whether a host is there', () => {
			const relay = new RemoteRelay();
			assert.throws(() => relay.sendCommand({ type: 'volume.set' }), NotRelayableError);
		});
	});
});
