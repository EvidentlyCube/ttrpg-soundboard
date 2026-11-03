import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsSync } from '../../public/app/logic/settings-sync.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {import('../../public/app/logic/ports.js').Volumes} Volumes */

/** @param {number} music */
const volumes = (music) => ({ master: 1, music, sfx: 1 });

function setup() {
	const clock = new FakeClock();
	/** @type {{ volumes: Volumes, keepalive: boolean, finish: (error?: Error) => void }[]} */
	const saves = [];
	/** @type {unknown[][]} */
	const warnings = [];
	const sync = new SettingsSync({
		clock,
		logger: { warn: (...args) => warnings.push(args), error: () => {} },
		what: 'volumes',
		save: (/** @type {Volumes} */ saved, { keepalive }) => new Promise((resolve, reject) => {
			saves.push({ volumes: saved, keepalive, finish: (error) => (error ? reject(error) : resolve()) });
		}),
	});
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	return { clock, saves, warnings, sync, settle };
}

describe('SettingsSync', () => {
	it('saves once, 500 ms after the last change, with the latest volumes', () => {
		const { clock, saves, sync } = setup();
		sync.schedule(volumes(0.1));
		clock.advance(300);
		sync.schedule(volumes(0.2));
		clock.advance(499);
		assert.equal(saves.length, 0);
		clock.advance(1);
		assert.deepEqual(saves.map(({ volumes: saved, keepalive }) => [saved.music, keepalive]), [[0.2, false]]);
	});

	it('sends a pending change immediately with keepalive when flushed', () => {
		const { clock, saves, sync } = setup();
		sync.schedule(volumes(0.3));
		sync.flush();
		assert.deepEqual(saves.map(({ volumes: saved, keepalive }) => [saved.music, keepalive]), [[0.3, true]]);
		clock.advance(1000);
		assert.equal(saves.length, 1);
	});

	it('does nothing on flush when nothing is pending', () => {
		const { saves, sync } = setup();
		sync.flush();
		assert.equal(saves.length, 0);
	});

	it('waits for a save in flight before sending the next one', async () => {
		const { clock, saves, sync, settle } = setup();
		sync.schedule(volumes(0.1));
		clock.advance(500);
		sync.schedule(volumes(0.2));
		clock.advance(500);
		assert.equal(saves.length, 1);
		saves[0].finish();
		await settle();
		assert.deepEqual(saves.map((save) => save.volumes.music), [0.1, 0.2]);
	});

	it('warns about a failed save and saves again on the next change', async () => {
		const { clock, saves, sync, warnings, settle } = setup();
		sync.schedule(volumes(0.4));
		clock.advance(500);
		saves[0].finish(new Error('offline'));
		await settle();
		assert.equal(warnings.length, 1);
		assert.match(String(warnings[0][0]), /Could not save the volumes/);
		sync.schedule(volumes(0.5));
		clock.advance(500);
		assert.deepEqual(saves.map((save) => save.volumes.music), [0.4, 0.5]);
	});

	describe('settle', () => {
		it('resolves at once when nothing is waiting', async () => {
			const { sync } = setup();
			await sync.settle();
		});

		it('sends a pending change now and resolves once it is saved', async () => {
			const { saves, sync, settle } = setup();
			sync.schedule(volumes(0.3));
			let settled = false;
			const settling = sync.settle().then(() => {
				settled = true;
			});
			assert.deepEqual(saves.map(({ volumes: saved, keepalive }) => [saved.music, keepalive]), [[0.3, false]]);
			await settle();
			assert.equal(settled, false);
			saves[0].finish();
			await settling;
		});

		it('waits for the save in flight and for the follow-up with the newer change', async () => {
			const { clock, saves, sync, settle } = setup();
			sync.schedule(volumes(0.1));
			clock.advance(500);
			sync.schedule(volumes(0.2));
			let settled = false;
			const settling = sync.settle().then(() => {
				settled = true;
			});
			saves[0].finish();
			await settle();
			assert.deepEqual(saves.map((save) => save.volumes.music), [0.1, 0.2]);
			assert.equal(settled, false);
			saves[1].finish();
			await settling;
		});

		it('resolves after a failed save too', async () => {
			const { saves, sync, warnings } = setup();
			sync.schedule(volumes(0.3));
			const settling = sync.settle();
			saves[0].finish(new Error('offline'));
			await settling;
			assert.equal(warnings.length, 1);
		});
	});

	it('saves null like any other value, as when the name is cleared', () => {
		const clock = new FakeClock();
		/** @type {(string | null)[]} */
		const saved = [];
		const sync = new SettingsSync({
			what: 'name',
			clock,
			logger: { warn: () => {}, error: () => {} },
			save: async (/** @type {string | null} */ name) => {
				saved.push(name);
			},
		});
		sync.schedule(null);
		clock.advance(500);
		assert.deepEqual(saved, [null]);
	});
});
