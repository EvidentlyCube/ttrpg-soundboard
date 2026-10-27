import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlayHistory } from '../../public/app/logic/play-history.js';
import { seededRandom } from '../helpers/seeded-random.js';

/** @typedef {import('../../public/app/logic/order-strategies.js').PlaybackOrder} PlaybackOrder */

/**
 * @param {PlaybackOrder} order
 * @param {{ trackCount?: number, loop?: boolean, maxLength?: number }} [options]
 */
function history(order, { trackCount = 4, loop = true, maxLength } = {}) {
	return new PlayHistory({ trackCount, order, random: seededRandom(42), loop, maxLength });
}

/**
 * @param {PlayHistory} played
 * @param {number} count
 */
function nexts(played, count) {
	return Array.from({ length: count }, () => played.next());
}

describe('PlayHistory', () => {
	it('starts empty and has nothing to play before it starts', () => {
		const played = history('ordered');
		assert.equal(played.current, null);
		assert.equal(played.upcoming(), null);
		assert.equal(played.next(), null);
	});

	it('plays ordered tracks in order and wraps by appending the playlist again', () => {
		const played = history('ordered');
		assert.equal(played.start(), 0);
		assert.deepEqual(nexts(played, 5), [1, 2, 3, 0, 1]);
	});

	it('goes back through the history and forward again over the same tracks', () => {
		const played = history('random', { trackCount: 6 });
		const first = played.start();
		const forward = nexts(played, 4);
		assert.deepEqual([played.previous(), played.previous()], [forward[2], forward[1]]);
		assert.deepEqual(nexts(played, 3), [forward[2], forward[3], played.current]);
		assert.notEqual(first, null);
	});

	it('never goes before the first entry', () => {
		const played = history('ordered');
		played.start(2);
		assert.equal(played.canGoBack, true);
		assert.deepEqual([played.previous(), played.previous(), played.previous()], [1, 0, null]);
		assert.equal(played.canGoBack, false);
		assert.equal(played.current, 0);

		const shuffled = history('shuffle');
		shuffled.start();
		assert.equal(shuffled.canGoBack, false);
		assert.equal(shuffled.previous(), null);
	});

	it('picks the upcoming track once, so next moves to the track it announced', () => {
		const played = history('random', { trackCount: 6 });
		played.start();
		const upcoming = played.upcoming();
		assert.equal(played.upcoming(), upcoming);
		assert.equal(played.next(), upcoming);
	});

	it('plays a whole shuffled round before the next one', () => {
		const played = history('shuffle', { trackCount: 5 });
		const round = [played.start(), ...nexts(played, 4)];
		assert.deepEqual(round.toSorted(), [0, 1, 2, 3, 4]);
		const nextRound = nexts(played, 5);
		assert.deepEqual(nextRound.toSorted(), [0, 1, 2, 3, 4]);
		assert.notEqual(nextRound[0], round[4]);
	});

	it('restarts around a chosen track, dropping the rest of the history', () => {
		const ordered = history('ordered');
		ordered.start();
		nexts(ordered, 2);
		assert.equal(ordered.start(3), 3);
		assert.deepEqual([ordered.previous(), ordered.previous()], [2, 1]);

		const shuffled = history('shuffle', { trackCount: 5 });
		shuffled.start();
		assert.equal(shuffled.start(2), 2);
		assert.equal(shuffled.canGoBack, false);
		assert.deepEqual([2, ...nexts(shuffled, 4)].toSorted(), [0, 1, 2, 3, 4]);

		const random = history('random');
		random.start();
		assert.equal(random.start(1), 1);
		assert.equal(random.canGoBack, false);
	});

	it('refills around the current track when the order changes', () => {
		const played = history('random', { trackCount: 6 });
		played.start();
		nexts(played, 3);
		const current = played.current;
		played.setOrder('ordered');
		assert.equal(played.current, current);
		assert.equal(played.next(), ((current ?? 0) + 1) % 6);
		assert.equal(played.previous(), current);
	});

	it('only takes the new order when the order changes before the playlist starts', () => {
		const played = history('random');
		played.setOrder('ordered');
		assert.equal(played.current, null);
		assert.equal(played.start(), 0);
	});

	it('ends instead of extending when the playlist does not loop', () => {
		const played = history('ordered', { trackCount: 2, loop: false });
		played.start();
		assert.deepEqual(nexts(played, 2), [1, null]);
		assert.equal(played.current, 1);
	});

	it('repeats a single track in every order', () => {
		for (const order of /** @type {PlaybackOrder[]} */ (['ordered', 'random', 'shuffle'])) {
			const played = history(order, { trackCount: 1 });
			assert.equal(played.start(), 0, order);
			assert.deepEqual(nexts(played, 3), [0, 0, 0], order);
		}
	});

	it('drops the oldest entries before the cursor beyond its maximum length', () => {
		const played = history('ordered', { trackCount: 4, maxLength: 6 });
		played.start();
		nexts(played, 9);
		assert.equal(played.length <= 6 + 4, true);
		assert.equal(played.current, 1);
		// Everything still reachable behind the cursor plays back in order.
		const back = [];
		while (played.canGoBack) {
			back.push(played.previous());
		}
		// 9 steps were taken, but only what fits in the maximum length is still behind the cursor: 0, 3, 2, 1, …
		assert.ok(back.length >= 1 && back.length < 9);
		back.forEach((track, i) => assert.equal(track, (4 - (i % 4)) % 4));
	});

	it('never cuts into the current round, even when a round is longer than the maximum length', () => {
		const played = history('ordered', { trackCount: 8, maxLength: 4 });
		played.start();
		assert.deepEqual(nexts(played, 8), [1, 2, 3, 4, 5, 6, 7, 0]);
	});

	it('keeps up to 2^16 entries by default', () => {
		const played = history('random', { trackCount: 3 });
		played.start();
		nexts(played, 70_000);
		assert.ok(played.length <= 2 ** 16);
	});
});
