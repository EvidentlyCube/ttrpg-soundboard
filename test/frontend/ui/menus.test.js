import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { playlistMenuItems, soundMenuItems } from '../../../public/app/ui/menus.js';

/** @param {import('../../../public/app/ui/menus.js').MenuItem[]} items */
const enabledLabels = (items) => items.filter((item) => item.enabled).map((item) => item.label);

describe('soundMenuItems', () => {
	it('lists Play, Stop All and Customize in order', () => {
		assert.deepEqual(soundMenuItems(false).map((item) => item.label), ['Play', 'Stop All', 'Customize']);
	});

	it('enables Stop All only while the sound is playing, and Customize always', () => {
		assert.deepEqual(enabledLabels(soundMenuItems(false)), ['Play', 'Customize']);
		assert.deepEqual(enabledLabels(soundMenuItems(true)), ['Play', 'Stop All', 'Customize']);
	});
});

describe('playlistMenuItems', () => {
	it('lists every item from DESIGN.md §9.3 in order', () => {
		assert.deepEqual(playlistMenuItems('idle').map((item) => item.label), [
			'Play', 'Play (Instant)', 'Next', 'Next (Instant)', 'Stop', 'Stop (Instant)', 'Customize',
		]);
	});

	it('only offers playing while idle, and Customize always', () => {
		assert.deepEqual(enabledLabels(playlistMenuItems('idle')), ['Play', 'Play (Instant)', 'Customize']);
	});

	it('offers next and stop while active, in every active state', () => {
		for (const state of /** @type {const} */ (['loading', 'playing', 'paused'])) {
			assert.deepEqual(enabledLabels(playlistMenuItems(state)), ['Next', 'Next (Instant)', 'Stop', 'Stop (Instant)', 'Customize'], state);
		}
	});

	it('groups the items so the menu can separate them', () => {
		assert.deepEqual(playlistMenuItems('idle').map((item) => item.group), [0, 0, 1, 1, 2, 2, 3]);
	});
});
