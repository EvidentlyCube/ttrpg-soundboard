import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appMenuItems, playlistMenuItems, selectorMenuItems, soundMenuItems } from '../../../public/app/ui/menus.js';
import { ICON_NAMES } from '../../../public/app/ui/icon-names.js';

/** @param {import('../../../public/app/ui/menus.js').MenuItem[]} items */
const enabledLabels = (items) => items.filter((item) => item.enabled).map((item) => item.label);

describe('appMenuItems', () => {
	it('offers becoming the host, the options, the info and the debug tools', () => {
		assert.deepEqual(enabledLabels(appMenuItems({ hosting: false })), ['Become host', 'Options', 'Info', 'Licenses', 'Debug', 'Change soundboard']);
	});

	it('offers to stop hosting and to connect a phone instead while the page is the host', () => {
		assert.deepEqual(enabledLabels(appMenuItems({ hosting: true })), ['Stop hosting', 'Connect a phone', 'Options', 'Info', 'Licenses', 'Debug', 'Change soundboard']);
	});

	it('before the start lists the same items, but only Info, Licenses and Change soundboard can be chosen', () => {
		const items = appMenuItems({ hosting: false, started: false });
		assert.deepEqual(items.map((item) => item.label), appMenuItems({ hosting: false }).map((item) => item.label));
		assert.deepEqual(enabledLabels(items), ['Info', 'Licenses', 'Change soundboard']);
	});
});

describe('selectorMenuItems', () => {
	it('offers the language and the licenses', () => {
		assert.deepEqual(enabledLabels(selectorMenuItems()), ['Language…', 'Licenses']);
	});
});

describe('soundMenuItems', () => {
	it('lists Play, Stop All, Customize and Metadata in order', () => {
		assert.deepEqual(soundMenuItems(false).map((item) => item.label), ['Play', 'Stop All', 'Customize', 'Metadata']);
	});

	it('enables Stop All only while the sound is playing, and the rest always', () => {
		assert.deepEqual(enabledLabels(soundMenuItems(false)), ['Play', 'Customize', 'Metadata']);
		assert.deepEqual(enabledLabels(soundMenuItems(true)), ['Play', 'Stop All', 'Customize', 'Metadata']);
	});
});

describe('playlistMenuItems', () => {
	const idle = { state: /** @type {const} */ ('idle'), resume: null };

	it('lists every item from DESIGN.md §9.3 in order', () => {
		assert.deepEqual(playlistMenuItems(idle).map((item) => item.label), [
			'Play', 'Play (Instant)', 'Next', 'Next (Instant)', 'Stop', 'Stop (Instant)', 'Reset', 'Customize', 'Metadata',
		]);
	});

	it('only offers playing while idle, and Customize and Metadata always', () => {
		assert.deepEqual(enabledLabels(playlistMenuItems(idle)), ['Play', 'Play (Instant)', 'Customize', 'Metadata']);
	});

	it('offers next and stop while active, in every active state', () => {
		for (const state of /** @type {const} */ (['loading', 'playing', 'paused'])) {
			assert.deepEqual(enabledLabels(playlistMenuItems({ state, resume: null })), ['Next', 'Next (Instant)', 'Stop', 'Stop (Instant)', 'Customize', 'Metadata'], state);
		}
	});

	it('offers Reset only while idle and remembering where to resume', () => {
		assert.deepEqual(enabledLabels(playlistMenuItems({ state: 'idle', resume: {} })), ['Play', 'Play (Instant)', 'Reset', 'Customize', 'Metadata']);
		assert.ok(!enabledLabels(playlistMenuItems({ state: 'playing', resume: {} })).includes('Reset'));
	});

	it('groups the items so the menu can separate them', () => {
		assert.deepEqual(playlistMenuItems(idle).map((item) => item.group), [0, 0, 1, 1, 2, 2, 2, 3, 3]);
	});
});

describe('menu icons', () => {
	it('gives the instant playlist items the bolt and the plain ones their own icon', () => {
		assert.deepEqual(playlistMenuItems({ state: 'idle', resume: null }).map((item) => item.icon), [
			'play', 'bolt', 'forward-step', 'bolt', 'stop', 'bolt', 'rotate-left', 'sliders', 'file-lines',
		]);
	});

	it('gives every item of every menu an icon from ICON_NAMES', () => {
		const menus = [
			appMenuItems({ hosting: false }),
			appMenuItems({ hosting: true }),
			selectorMenuItems(),
			soundMenuItems(true),
			playlistMenuItems({ state: 'playing', resume: null }),
		];
		for (const item of menus.flat()) {
			assert.ok(ICON_NAMES.includes(item.icon), `${item.id}: ${item.icon}`);
		}
	});
});
