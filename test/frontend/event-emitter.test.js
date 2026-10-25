import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from '../../public/app/logic/event-emitter.js';

/** @typedef {{ type: 'a', value: number } | { type: 'b' }} TestEvent */

describe('EventEmitter', () => {
	it('calls handlers for the matching type in subscription order', () => {
		/** @type {EventEmitter<TestEvent>} */
		const emitter = new EventEmitter();
		/** @type {string[]} */
		const calls = [];
		emitter.on('a', (event) => calls.push(`first ${event.value}`));
		emitter.on('a', (event) => calls.push(`second ${event.value}`));
		emitter.on('b', () => calls.push('b'));
		emitter.emit({ type: 'a', value: 1 });
		assert.deepEqual(calls, ['first 1', 'second 1']);
	});

	it('unsubscribes through off or the returned function', () => {
		/** @type {EventEmitter<TestEvent>} */
		const emitter = new EventEmitter();
		let count = 0;
		const handler = () => count++;
		const unsubscribe = emitter.on('b', handler);
		emitter.emit({ type: 'b' });
		unsubscribe();
		emitter.emit({ type: 'b' });
		emitter.on('b', handler);
		emitter.off('b', handler);
		emitter.emit({ type: 'b' });
		assert.equal(count, 1);
	});

	it('keeps notifying the remaining handlers when one throws', () => {
		/** @type {unknown[]} */
		const errors = [];
		/** @type {EventEmitter<TestEvent>} */
		const emitter = new EventEmitter((error) => errors.push(error));
		let reached = false;
		emitter.on('b', () => {
			throw new Error('broken handler');
		});
		emitter.on('b', () => (reached = true));
		emitter.emit({ type: 'b' });
		assert.equal(reached, true);
		assert.match(String(errors[0]), /broken handler/);
	});

	it('is unaffected by handlers that unsubscribe while being called', () => {
		/** @type {EventEmitter<TestEvent>} */
		const emitter = new EventEmitter();
		let second = 0;
		const unsubscribe = emitter.on('b', () => unsubscribe());
		emitter.on('b', () => second++);
		emitter.emit({ type: 'b' });
		emitter.emit({ type: 'b' });
		assert.equal(second, 2);
	});
});
