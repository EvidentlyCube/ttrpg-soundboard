import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from './fake-clock.js';

describe('FakeClock', () => {
	it('fires timeouts in time order when advanced', () => {
		const clock = new FakeClock();
		/** @type {string[]} */
		const fired = [];
		clock.setTimeout(() => fired.push('b'), 200);
		clock.setTimeout(() => fired.push('a'), 100);
		clock.advance(150);
		assert.deepEqual(fired, ['a']);
		clock.advance(50);
		assert.deepEqual(fired, ['a', 'b']);
		assert.equal(clock.now(), 200);
	});

	it('repeats intervals until cleared', () => {
		const clock = new FakeClock();
		let count = 0;
		const id = clock.setInterval(() => count++, 250);
		clock.advance(1000);
		assert.equal(count, 4);
		clock.clearInterval(id);
		clock.advance(1000);
		assert.equal(count, 4);
	});

	it('fires timers created by timers within the same advance', () => {
		const clock = new FakeClock();
		/** @type {number[]} */
		const times = [];
		clock.setTimeout(() => {
			times.push(clock.now());
			clock.setTimeout(() => times.push(clock.now()), 10);
		}, 10);
		clock.advance(100);
		assert.deepEqual(times, [10, 20]);
	});

	it('does not fire cleared timeouts and counts pending timers', () => {
		const clock = new FakeClock();
		let fired = false;
		const id = clock.setTimeout(() => (fired = true), 10);
		assert.equal(clock.pendingTimerCount, 1);
		clock.clearTimeout(id);
		clock.advance(100);
		assert.equal(fired, false);
		assert.equal(clock.pendingTimerCount, 0);
	});
});
