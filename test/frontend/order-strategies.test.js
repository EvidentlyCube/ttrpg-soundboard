import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderStrategy, PLAYBACK_ORDERS } from '../../public/app/logic/order-strategies.js';
import { seededRandom } from '../helpers/seeded-random.js';

/** @param {number} count */
const range = (count) => Array.from({ length: count }, (_, i) => i);
/** @param {number[]} entries */
const sorted = (entries) => entries.toSorted((a, b) => a - b);

describe('ordered', () => {
	const ordered = orderStrategy('ordered');

	it('starts with the whole playlist in order, at the first track or the given one', () => {
		assert.deepEqual(ordered.start(4, Math.random, null, true), { entries: [0, 1, 2, 3], cursor: 0 });
		assert.deepEqual(ordered.start(4, Math.random, 2, true), { entries: [0, 1, 2, 3], cursor: 2 });
	});

	it('extends with the whole playlist in order again', () => {
		assert.deepEqual(ordered.extend(4, Math.random, 3), [0, 1, 2, 3]);
		assert.deepEqual(ordered.extend(1, Math.random, 0), [0]);
	});
});

describe('random', () => {
	const random = orderStrategy('random');

	it('starts with one random track, or the given one', () => {
		const { entries, cursor } = random.start(6, seededRandom(1), null, true);
		assert.equal(entries.length, 1);
		assert.ok(entries[0] >= 0 && entries[0] < 6);
		assert.equal(cursor, 0);
		assert.deepEqual(random.start(6, seededRandom(1), 4, true), { entries: [4], cursor: 0 });
	});

	it('extends one track at a time, never the one that just played', () => {
		const next = seededRandom(7);
		let last = 0;
		/** @type {Set<number>} */
		const seen = new Set();
		for (let i = 0; i < 500; i++) {
			const entries = random.extend(5, next, last);
			assert.equal(entries.length, 1);
			assert.notEqual(entries[0], last);
			last = entries[0];
			seen.add(last);
		}
		assert.deepEqual(sorted([...seen]), range(5));
	});

	it('repeats a single track instead of looking for another', () => {
		assert.deepEqual(random.extend(1, () => 0.99, 0), [0]);
	});
});

describe('shuffle', () => {
	const shuffle = orderStrategy('shuffle');

	it('starts with a shuffled round of every track', () => {
		const { entries, cursor } = shuffle.start(6, seededRandom(3), null, true);
		assert.deepEqual(sorted(entries), range(6));
		assert.equal(cursor, 0);
	});

	it('starts the round with the given track', () => {
		for (let seed = 0; seed < 20; seed++) {
			const { entries } = shuffle.start(6, seededRandom(seed), 4, true);
			assert.equal(entries[0], 4);
			assert.deepEqual(sorted(entries), range(6));
		}
	});

	it('extends with a new round that never starts with the track that just played', () => {
		for (let seed = 0; seed < 50; seed++) {
			const entries = shuffle.extend(4, seededRandom(seed), 2);
			assert.deepEqual(sorted(entries), range(4));
			assert.notEqual(entries[0], 2);
		}
	});

	it('repeats a single track instead of looking for another', () => {
		assert.deepEqual(shuffle.extend(1, () => 0.99, 0), [0]);
	});

	it('shuffles differently from round to round', () => {
		const next = seededRandom(11);
		const rounds = new Set(range(10).map(() => shuffle.extend(6, next, 0).join()));
		assert.ok(rounds.size > 5);
	});
});

describe('without playlist looping', () => {
	it('fills Random with a round of every track, starting at the chosen one', () => {
		const random = orderStrategy('random');
		const { entries, cursor } = random.start(6, seededRandom(1), null, false);
		assert.deepEqual([...entries].sort(), [0, 1, 2, 3, 4, 5]);
		assert.equal(cursor, 0);
		assert.equal(random.start(6, seededRandom(1), 4, false).entries[0], 4);
	});

	it('leaves Ordered and Shuffle as they are', () => {
		assert.deepEqual(orderStrategy('ordered').start(4, Math.random, 2, false), { entries: [0, 1, 2, 3], cursor: 2 });
		assert.deepEqual(orderStrategy('shuffle').start(6, seededRandom(3), null, false), orderStrategy('shuffle').start(6, seededRandom(3), null, true));
	});
});

describe('every order', () => {
	it('gives the same entries for the same seed', () => {
		for (const name of PLAYBACK_ORDERS) {
			const strategy = orderStrategy(name);
			assert.deepEqual(strategy.start(8, seededRandom(5), null, true), strategy.start(8, seededRandom(5), null, true), name);
			assert.deepEqual(strategy.extend(8, seededRandom(5), 3), strategy.extend(8, seededRandom(5), 3), name);
		}
	});

	it('has nothing to play for an empty playlist', () => {
		for (const name of PLAYBACK_ORDERS) {
			assert.deepEqual(orderStrategy(name).start(0, Math.random, null, true), { entries: [], cursor: 0 }, name);
			assert.deepEqual(orderStrategy(name).extend(0, Math.random, 0), [], name);
		}
	});

	it('rejects unknown orders', () => {
		assert.throws(() => orderStrategy(/** @type {any} */ ('sequential')), /Unknown playback order "sequential"/);
	});
});
