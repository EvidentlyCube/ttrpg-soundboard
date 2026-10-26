import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OptionsSync } from '../../public/app/logic/options-sync.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {{ title?: string, gain?: number }} Options */

function setup() {
	const clock = new FakeClock();
	/** @type {{ id: string, options: Options, keepalive: boolean, finish: (error?: Error) => void }[]} */
	const saves = [];
	/** @type {string[]} */
	const outcomes = [];
	const sync = new OptionsSync({
		clock,
		save: (id, options, { keepalive }) => new Promise((resolve, reject) => {
			saves.push({ id, options, keepalive, finish: (error) => (error ? reject(error) : resolve()) });
		}),
		onSaved: (id) => outcomes.push(`saved ${id}`),
		onFailed: (id, error) => outcomes.push(`failed ${id}: ${error.message}`),
	});
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	const sent = () => saves.map(({ id, options, keepalive }) => [id, options, keepalive]);
	return { clock, saves, outcomes, sync, settle, sent };
}

describe('OptionsSync', () => {
	it('saves once, 500 ms after the last change to an item, with its latest options', () => {
		const { clock, sync, sent } = setup();
		sync.schedule('a', { gain: 0.1 });
		clock.advance(300);
		sync.schedule('a', { gain: 0.2 });
		clock.advance(499);
		assert.deepEqual(sent(), []);
		clock.advance(1);
		assert.deepEqual(sent(), [['a', { gain: 0.2 }, false]]);
	});

	it('keeps separate timers for separate items', () => {
		const { clock, sync, sent } = setup();
		sync.schedule('a', { gain: 1 });
		clock.advance(300);
		sync.schedule('b', { gain: 2 });
		clock.advance(200);
		assert.deepEqual(sent(), [['a', { gain: 1 }, false]]);
		clock.advance(300);
		assert.deepEqual(sent(), [['a', { gain: 1 }, false], ['b', { gain: 2 }, false]]);
	});

	it('reports an item as saved only when nothing more is waiting for it', async () => {
		const { clock, saves, outcomes, sync, settle } = setup();
		sync.schedule('a', { gain: 1 });
		clock.advance(500);
		sync.schedule('a', { gain: 2 });
		saves[0].finish();
		await settle();
		assert.deepEqual(outcomes, []);
		clock.advance(500);
		saves[1].finish();
		await settle();
		assert.deepEqual(outcomes, ['saved a']);
	});

	it('waits for a save of the same item in flight before sending the next one', async () => {
		const { clock, saves, sync, settle, sent } = setup();
		sync.schedule('a', { gain: 1 });
		clock.advance(500);
		sync.schedule('a', { gain: 2 });
		sync.schedule('a', { gain: 3 });
		clock.advance(500);
		assert.equal(saves.length, 1);
		saves[0].finish();
		await settle();
		assert.deepEqual(sent(), [['a', { gain: 1 }, false], ['a', { gain: 3 }, false]]);
	});

	it('reports a failure, and saves the full options again with the next change', async () => {
		const { clock, saves, outcomes, sync, settle, sent } = setup();
		sync.schedule('a', { title: 'X', gain: 1 });
		clock.advance(500);
		saves[0].finish(new Error('disk full'));
		await settle();
		assert.deepEqual(outcomes, ['failed a: disk full']);
		sync.schedule('a', { title: 'X', gain: 2 });
		clock.advance(500);
		assert.deepEqual(sent().at(-1), ['a', { title: 'X', gain: 2 }, false]);
	});

	it('flushes one item right away, still after its save in flight', async () => {
		const { clock, saves, sync, settle, sent } = setup();
		sync.schedule('a', { gain: 1 });
		sync.schedule('b', { gain: 5 });
		sync.flush('a');
		assert.deepEqual(sent(), [['a', { gain: 1 }, false]]);

		sync.schedule('a', { gain: 2 });
		sync.flush('a');
		assert.equal(saves.length, 1);
		saves[0].finish();
		await settle();
		assert.deepEqual(sent(), [['a', { gain: 1 }, false], ['a', { gain: 2 }, false]]);

		clock.advance(500);
		assert.deepEqual(sent().at(-1), ['b', { gain: 5 }, false], 'other items keep their timers');
	});

	it('sends everything pending at once with keepalive when the page closes', () => {
		const { clock, sync, sent } = setup();
		sync.schedule('a', { gain: 1 });
		sync.schedule('b', { gain: 2 });
		sync.flushAll();
		assert.deepEqual(sent(), [['a', { gain: 1 }, true], ['b', { gain: 2 }, true]]);
		clock.advance(1000);
		assert.equal(sent().length, 2);
	});

	it('does nothing when flushing with nothing pending', () => {
		const { sync, sent } = setup();
		sync.flush('a');
		sync.flushAll();
		assert.deepEqual(sent(), []);
	});
});
