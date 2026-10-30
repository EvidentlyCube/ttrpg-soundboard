import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	HOST_GRACE_MS,
	HostTakenError,
	NoHostError,
	NotRelayableError,
	RemoteRelay,
	UnknownPageError,
} from '../../../src/remote/remote-relay.js';
import { FakeClock } from '../../helpers/fake-clock.js';

/** A stream's `send`, recording what it was given. */
function recorder() {
	/** @type {object[]} */
	const messages = [];
	return { messages, send: (/** @type {object} */ message) => messages.push(message) };
}

function setup() {
	const clock = new FakeClock();
	const relay = new RemoteRelay({ timers: clock });
	return { clock, relay };
}

/**
 * A page with an open stream.
 * @param {RemoteRelay} relay
 * @param {string} id
 */
function openPage(relay, id) {
	const stream = recorder();
	const detach = relay.attachPage(id, stream.send);
	return { ...stream, detach };
}

describe('RemoteRelay', () => {
	describe('pages', () => {
		it('tells a page that it is not the host', () => {
			const { relay } = setup();
			assert.deepEqual(openPage(relay, 'a').messages, [{ type: 'remote.role', host: false }]);
		});

		it('tells the host that it is the host when it reconnects', () => {
			const { relay } = setup();
			const first = openPage(relay, 'a');
			relay.claimHost('a');
			first.detach();
			assert.deepEqual(openPage(relay, 'a').messages, [{ type: 'remote.role', host: true }]);
		});

		it('refuses a claim from a page without a stream', () => {
			const { relay } = setup();
			assert.throws(() => relay.claimHost('a'), UnknownPageError);
		});
	});

	describe('claiming the host role', () => {
		it('gives it to the first page that asks', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			assert.equal(relay.hasHost, false);
			relay.claimHost('a');
			assert.equal(relay.hasHost, true);
		});

		it('does not give it away unasked: a second page is refused unless it says it may replace', () => {
			const { relay } = setup();
			const first = openPage(relay, 'a');
			openPage(relay, 'b');
			relay.claimHost('a');
			assert.throws(() => relay.claimHost('b'), HostTakenError);
			relay.sendCommand({ type: 'panic.stop' });
			assert.deepEqual(first.messages.at(-1), { type: 'command', command: { type: 'panic.stop' } });
		});

		it('claiming again as the host changes nothing', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			const remote = recorder();
			relay.claimHost('a');
			relay.attachRemote(remote.send);
			relay.claimHost('a');
			assert.deepEqual(remote.messages, [{ type: 'remote.host', connected: true }]);
		});

		it('replaces the host when told to, and tells the old one', () => {
			const { relay } = setup();
			const old = openPage(relay, 'a');
			const next = openPage(relay, 'b');
			relay.claimHost('a');
			relay.claimHost('b', { replace: true });
			assert.deepEqual(old.messages.at(-1), { type: 'remote.role', host: false, reason: 'replaced' });
			relay.sendCommand({ type: 'panic.stop' });
			assert.deepEqual(next.messages.at(-1), { type: 'command', command: { type: 'panic.stop' } });
			assert.equal(old.messages.some((message) => 'command' in message), false);
		});

		it("drops the old host's state when it is replaced", () => {
			const { relay } = setup();
			openPage(relay, 'a');
			openPage(relay, 'b');
			relay.claimHost('a');
			relay.updateState('a', { panic: 'now' });
			const remote = recorder();
			relay.attachRemote(remote.send);
			relay.claimHost('b', { replace: true });
			assert.deepEqual(remote.messages.slice(-3), [
				{ type: 'remote.host', connected: false },
				{ type: 'remote.state', state: null },
				{ type: 'remote.host', connected: true },
			]);
			assert.equal(relay.updateState('a', { panic: 'fade' }), false);
		});

		it('lets the old host find out when it was replaced while disconnected', () => {
			const { relay } = setup();
			const old = openPage(relay, 'a');
			openPage(relay, 'b');
			relay.claimHost('a');
			old.detach();
			relay.claimHost('b', { replace: true });
			assert.deepEqual(openPage(relay, 'a').messages, [{ type: 'remote.role', host: false }]);
		});
	});

	describe('giving the role up', () => {
		it('frees it when the host releases it, and nobody inherits it', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			const other = openPage(relay, 'b');
			relay.claimHost('a');
			assert.equal(relay.releaseHost('a'), true);
			assert.equal(relay.hasHost, false);
			assert.throws(() => relay.sendCommand({ type: 'panic.stop' }), NoHostError);
			assert.deepEqual(other.messages, [{ type: 'remote.role', host: false }]);
		});

		it('ignores a release from a page that is not the host', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			openPage(relay, 'b');
			relay.claimHost('a');
			assert.equal(relay.releaseHost('b'), false);
			assert.equal(relay.hasHost, true);
		});

		it("keeps the role while the host's stream is closed for less than the grace period", () => {
			const { relay, clock } = setup();
			const page = openPage(relay, 'a');
			relay.claimHost('a');
			page.detach();
			clock.advance(HOST_GRACE_MS - 1);
			assert.equal(relay.hasHost, true);
			openPage(relay, 'a');
			clock.advance(HOST_GRACE_MS * 2);
			assert.equal(relay.hasHost, true);
		});

		it('frees the role once the stream stayed closed for the grace period', () => {
			const { relay, clock } = setup();
			const page = openPage(relay, 'a');
			relay.claimHost('a');
			const remote = recorder();
			relay.attachRemote(remote.send);
			page.detach();
			clock.advance(HOST_GRACE_MS);
			assert.equal(relay.hasHost, false);
			assert.deepEqual(remote.messages.slice(-2), [
				{ type: 'remote.host', connected: false },
				{ type: 'remote.state', state: null },
			]);
		});

		it('does not count a page that closed an older stream while a newer one is open', () => {
			const { relay, clock } = setup();
			const older = openPage(relay, 'a');
			openPage(relay, 'a');
			relay.claimHost('a');
			older.detach();
			clock.advance(HOST_GRACE_MS * 2);
			assert.equal(relay.hasHost, true);
		});

		it('does not start a timer for a page that is not the host', () => {
			const { relay, clock } = setup();
			openPage(relay, 'a').detach();
			assert.equal(clock.pendingTimerCount, 0);
			assert.equal(relay.hasHost, false);
		});

		it('keeps no timer after the host released the role', () => {
			const { relay, clock } = setup();
			const page = openPage(relay, 'a');
			relay.claimHost('a');
			page.detach();
			relay.releaseHost('a');
			assert.equal(clock.pendingTimerCount, 0);
		});
	});

	describe('remotes', () => {
		it('tells a new remote that no host is connected', () => {
			const { relay } = setup();
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.deepEqual(remote.messages, [{ type: 'remote.host', connected: false }]);
		});

		it('gives a new remote the host and the latest state', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			relay.claimHost('a');
			relay.updateState('a', { panic: 'fade' });
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.deepEqual(remote.messages, [
				{ type: 'remote.host', connected: true },
				{ type: 'remote.state', state: { panic: 'fade' } },
			]);
		});

		it('sends every state to every remote', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			relay.claimHost('a');
			const first = recorder();
			const second = recorder();
			relay.attachRemote(first.send);
			relay.attachRemote(second.send);
			relay.updateState('a', { panic: 'now' });
			assert.deepEqual(first.messages.at(-1), { type: 'remote.state', state: { panic: 'now' } });
			assert.deepEqual(second.messages.at(-1), { type: 'remote.state', state: { panic: 'now' } });
		});

		it('tells the remotes already attached when a host appears', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			const remote = recorder();
			relay.attachRemote(remote.send);
			relay.claimHost('a');
			assert.deepEqual(remote.messages.at(-1), { type: 'remote.host', connected: true });
		});

		it('stops sending to a remote that detached', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			relay.claimHost('a');
			const remote = recorder();
			const detach = relay.attachRemote(remote.send);
			detach();
			relay.updateState('a', { panic: 'now' });
			assert.equal(remote.messages.length, 1);
		});

		it('ignores a state from a page that is not the host', () => {
			const { relay } = setup();
			openPage(relay, 'a');
			openPage(relay, 'b');
			relay.claimHost('a');
			const remote = recorder();
			relay.attachRemote(remote.send);
			assert.equal(relay.updateState('b', { panic: 'now' }), false);
			assert.equal(remote.messages.length, 1);
		});
	});

	describe('commands', () => {
		it('passes the allowed commands to the host', () => {
			const { relay } = setup();
			const host = openPage(relay, 'a');
			relay.claimHost('a');
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
			assert.deepEqual(host.messages.slice(1), commands.map((command) => ({ type: 'command', command })));
		});

		it('refuses a command that could change the library or the settings', () => {
			const { relay } = setup();
			const host = openPage(relay, 'a');
			relay.claimHost('a');
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
			assert.equal(host.messages.length, 1);
		});

		it('refuses an allowed command while no host is connected', () => {
			const { relay } = setup();
			assert.throws(() => relay.sendCommand({ type: 'panic.stop' }), NoHostError);
		});

		it("refuses it while the host's stream is closed, though it still has the role", () => {
			const { relay } = setup();
			const host = openPage(relay, 'a');
			relay.claimHost('a');
			host.detach();
			assert.throws(() => relay.sendCommand({ type: 'panic.stop' }), NoHostError);
		});

		it('checks what the command is before whether a host is there', () => {
			const { relay } = setup();
			assert.throws(() => relay.sendCommand({ type: 'volume.set' }), NotRelayableError);
		});
	});
});
