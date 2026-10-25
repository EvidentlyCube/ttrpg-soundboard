import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareNatural, sortBy } from '../../../src/library/sort.js';

describe('compareNatural', () => {
	it('orders numbers by value', () => {
		assert.deepEqual(['10 b', '2 a', '1 c'].sort(compareNatural), ['1 c', '2 a', '10 b']);
	});

	it('ignores case and accents', () => {
		assert.deepEqual(['b', 'Á', 'c', 'a'].sort(compareNatural), ['a', 'Á', 'b', 'c']);
	});

	it('breaks ties deterministically so the order never depends on input order', () => {
		assert.deepEqual(['a', 'A'].sort(compareNatural), ['A', 'a']);
		assert.deepEqual(['A', 'a'].sort(compareNatural), ['A', 'a']);
	});
});

describe('sortBy', () => {
	it('sorts by the given key without mutating the input', () => {
		const items = [{ title: 'Track 10' }, { title: 'Track 9' }];
		assert.deepEqual(sortBy(items, (item) => item.title), [{ title: 'Track 9' }, { title: 'Track 10' }]);
		assert.equal(items[0].title, 'Track 10');
	});
});
