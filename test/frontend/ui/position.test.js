import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placeInViewport } from '../../../public/app/ui/position.js';

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 200, height: 300 };

describe('placeInViewport', () => {
	it('opens at the requested point when it fits', () => {
		assert.deepEqual(placeInViewport({ x: 100, y: 100 }, MENU, VIEWPORT), { x: 100, y: 100 });
	});

	it('flips above and to the left of the point near the bottom-right edge', () => {
		assert.deepEqual(placeInViewport({ x: 950, y: 700 }, MENU, VIEWPORT), { x: 750, y: 400 });
	});

	it('clamps inside the margin when neither side fits', () => {
		assert.deepEqual(placeInViewport({ x: 100, y: 200 }, { width: 200, height: 790 }, VIEWPORT), { x: 100, y: 8 });
	});

	it('keeps a margin from the edges', () => {
		assert.deepEqual(placeInViewport({ x: 0, y: 2 }, MENU, VIEWPORT), { x: 8, y: 8 });
	});
});
