import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortBy } from '../../public/app/logic/sort.js';
import { sortBy as serverSortBy } from '../../src/library/sort.js';

describe('sortBy', () => {
	it('sorts naturally, ignoring case and accents', () => {
		assert.deepEqual(sortBy(['b', 'Sound 10', 'sound 9', 'Ábc', 'a'], (title) => title), ['a', 'Ábc', 'b', 'sound 9', 'Sound 10']);
	});

	it('orders exactly like the server, so a re-sort in the browser never disagrees with a reload', () => {
		const titles = ['Track 2', 'track 10', 'Zebra', 'zebra', 'Zébra', 'Éclair', 'eclair', '10 Drums', '9 Drums', 'Boom!', 'boom', '', ' x', 'Ω', 'ω', 'a1b2', 'a1b10'];
		const identity = (/** @type {string} */ title) => title;
		assert.deepEqual(sortBy(titles, identity), serverSortBy(titles, identity));
		assert.deepEqual(sortBy(titles.toReversed(), identity), serverSortBy(titles, identity));
	});
});
