import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OptionsSync } from '../../public/app/logic/options-sync.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {import('../../public/app/logic/options-sync.js').ItemRef} ItemRef */
/** @typedef {{ title?: string, gain?: number }} Options */

/** @type {ItemRef} */
const A = { kind: 'sound', id: 'a' };
/** @type {ItemRef} */
const B = { kind: 'sound', id: 'b' };

/** @param {ItemRef} item */
const name = (item) => `${item.kind} ${item.id}`;

function setup() {
	const clock = new FakeClock();
	/** @type {{ item: ItemRef, options: Options, keepalive: boolean, finish: (error?: Error) => void }[]} */
	const saves = [];
	/** @type {string[]} */
	const outcomes = [];
	const sync = new OptionsSync({
		clock,
		save: (item, options, { keepalive }) => new Promise((resolve, reject) => {
			saves.push({ item, options, keepalive, finish: (error) => (error ? reject(error) : resolve()) });
		}),
		onSaved: (item) => outcomes.push(`saved ${name(item)}`),
		onFailed: (item, error) => outcomes.push(`failed ${name(item)}: ${error.message}`),
	});
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	const sent = () => saves.map(({ item, options, keepalive }) => [item.id, options, keepalive]);
	return { clock, saves, outcomes, sync, settle, sent };
}

describe('OptionsSync', () => {
	it('saves once, 500 ms after the last change to an item, with its latest options', () => {
		const { clock, sync, sent } = setup();
		sync.schedule(A, { gain: 0.1 });
		clock.advance(300);
		sync.schedule(A, { gain: 0.2 });
		clock.advance(499);
		assert.deepEqual(sent(), []);
		clock.advance(1);
		assert.deepEqual(sent(), [['a', { gain: 0.2 }, false]]);
	});

	it('keeps separate timers for separate items', () => {
		const { clock, sync, sent } = setup();
		sync.schedule(A, { gain: 1 });
		clock.advance(300);
		sync.schedule(B, { gain: 2 });
		clock.advance(200);
		assert.deepEqual(sent(), [['a', { gain: 1 }, false]]);
		clock.advance(300);
		assert.deepEqual(sent(), [['a', { gain: 1 }, false], ['b', { gain: 2 }, false]]);
	});

	it('keeps a sound and a playlist with the same id apart', async () => {
		const { clock, saves, outcomes, sync, settle } = setup();
		sync.schedule({ kind: 'sound', id: 'x' }, { gain: 1 });
		sync.schedule({ kind: 'playlist', id: 'x' }, { gain: 2 });
		clock.advance(500);
		assert.deepEqual(saves.map(({ item, options }) => [name(item), options.gain]), [['sound x', 1], ['playlist x', 2]]);
		saves[1].finish();
		await settle();
		assert.deepEqual(outcomes, ['saved playlist x']);
	});

	it('reports an item as saved only when nothing more is waiting for it', async () => {
		const { clock, saves, outcomes, sync, settle } = setup();
		sync.schedule(A, { gain: 1 });
		clock.advance(500);
		sync.schedule(A, { gain: 2 });
		saves[0].finish();
		await settle();
		assert.deepEqual(outcomes, []);
		clock.advance(500);
		saves[1].finish();
		await settle();
		assert.deepEqual(outcomes, ['saved sound a']);
	});

	it('waits for a save of the same item in flight before sending the next one', async () => {
		const { clock, saves, sync, settle, sent } = setup();
		sync.schedule(A, { gain: 1 });
		clock.advance(500);
		sync.schedule(A, { gain: 2 });
		sync.schedule(A, { gain: 3 });
		clock.advance(500);
		assert.equal(saves.length, 1);
		saves[0].finish();
		await settle();
		assert.deepEqual(sent(), [['a', { gain: 1 }, false], ['a', { gain: 3 }, false]]);
	});

	it('reports a failure, and saves the full options again with the next change', async () => {
		const { clock, saves, outcomes, sync, settle, sent } = setup();
		sync.schedule(A, { title: 'X', gain: 1 });
		clock.advance(500);
		saves[0].finish(new Error('disk full'));
		await settle();
		assert.deepEqual(outcomes, ['failed sound a: disk full']);
		sync.schedule(A, { title: 'X', gain: 2 });
		clock.advance(500);
		assert.deepEqual(sent().at(-1), ['a', { title: 'X', gain: 2 }, false]);
	});

	it('flushes one item right away, still after its save in flight', async () => {
		const { clock, saves, sync, settle, sent } = setup();
		sync.schedule(A, { gain: 1 });
		sync.schedule(B, { gain: 5 });
		sync.flush(A);
		assert.deepEqual(sent(), [['a', { gain: 1 }, false]]);

		sync.schedule(A, { gain: 2 });
		sync.flush(A);
		assert.equal(saves.length, 1);
		saves[0].finish();
		await settle();
		assert.deepEqual(sent(), [['a', { gain: 1 }, false], ['a', { gain: 2 }, false]]);

		clock.advance(500);
		assert.deepEqual(sent().at(-1), ['b', { gain: 5 }, false], 'other items keep their timers');
	});

	it('sends everything pending at once with keepalive when the page closes', () => {
		const { clock, sync, sent } = setup();
		sync.schedule(A, { gain: 1 });
		sync.schedule(B, { gain: 2 });
		sync.flushAll();
		assert.deepEqual(sent(), [['a', { gain: 1 }, true], ['b', { gain: 2 }, true]]);
		clock.advance(1000);
		assert.equal(sent().length, 2);
	});

	it('does nothing when flushing with nothing pending', () => {
		const { sync, sent } = setup();
		sync.flush(A);
		sync.flushAll();
		assert.deepEqual(sent(), []);
	});

	describe('settleAll', () => {
		it('resolves at once when nothing is waiting', async () => {
			const { sync } = setup();
			await sync.settleAll();
		});

		it('sends every pending change now and resolves once all are saved', async () => {
			const { saves, sync, settle, sent, outcomes } = setup();
			sync.schedule(A, { gain: 0.1 });
			sync.schedule(B, { gain: 0.2 });
			let settled = false;
			const settling = sync.settleAll().then(() => {
				settled = true;
			});
			assert.deepEqual(sent(), [['a', { gain: 0.1 }, false], ['b', { gain: 0.2 }, false]]);
			saves[0].finish();
			await settle();
			assert.equal(settled, false);
			saves[1].finish(new Error('offline'));
			await settling;
			assert.deepEqual(outcomes, ['saved sound a', 'failed sound b: offline']);
		});

		it('waits for the save in flight and for the follow-up with the newer change', async () => {
			const { clock, saves, sync, settle, sent } = setup();
			sync.schedule(A, { gain: 0.1 });
			clock.advance(500);
			sync.schedule(A, { gain: 0.2 });
			let settled = false;
			const settling = sync.settleAll().then(() => {
				settled = true;
			});
			saves[0].finish();
			await settle();
			assert.deepEqual(sent(), [['a', { gain: 0.1 }, false], ['a', { gain: 0.2 }, false]]);
			assert.equal(settled, false);
			saves[1].finish();
			await settling;
		});
	});
});
