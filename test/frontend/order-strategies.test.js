import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderStrategy } from '../../public/app/logic/order-strategies.js';

describe('sequential order', () => {
	it('walks forward and wraps around when looping', () => {
		const order = createOrderStrategy('sequential', 3, { loop: true });
		assert.equal(order.first(), 0);
		assert.equal(order.next(0), 1);
		assert.equal(order.next(2), 0);
		assert.equal(order.previous(1), 0);
		assert.equal(order.previous(0), 2);
	});

	it('ends at the edges without looping', () => {
		const order = createOrderStrategy('sequential', 3, { loop: false });
		assert.equal(order.next(2), null);
		assert.equal(order.previous(0), null);
	});

	it('loops a single track onto itself', () => {
		const order = createOrderStrategy('sequential', 1, { loop: true });
		assert.equal(order.next(0), 0);
		assert.equal(order.previous(0), 0);
	});

	it('has nothing to play when the playlist is empty', () => {
		const order = createOrderStrategy('sequential', 0, { loop: true });
		assert.equal(order.first(), null);
		assert.equal(order.next(0), null);
		assert.equal(order.previous(0), null);
	});
});

describe('createOrderStrategy', () => {
	it('rejects unknown strategies', () => {
		assert.throws(() => createOrderStrategy('shuffle', 3, { loop: true }), /Unknown order strategy "shuffle"/);
	});
});
