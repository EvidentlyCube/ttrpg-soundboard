import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	clampEnd,
	clampStart,
	formatMs,
	fromStored,
	msAt,
	nearerHandle,
	parseMs,
	shareOf,
	stepFor,
	toStoredEnd,
} from '../../../public/app/ui/range-scale.js';

describe('range scale', () => {
	describe('clampStart and clampEnd', () => {
		it('keep the start between 0 and 10 ms before the end', () => {
			assert.equal(clampStart(-5, 1000), 0);
			assert.equal(clampStart(500, 1000), 500);
			assert.equal(clampStart(995, 1000), 990);
		});

		it('keep the end between 10 ms after the start and the duration', () => {
			assert.equal(clampEnd(5000, 0, 4210), 4210);
			assert.equal(clampEnd(1000, 0, 4210), 1000);
			assert.equal(clampEnd(505, 500, 4210), 510);
		});

		it('round to whole milliseconds', () => {
			assert.equal(clampStart(12.6, 1000), 13);
			assert.equal(clampEnd(999.4, 0, 4210), 999);
		});
	});

	describe('msAt and shareOf', () => {
		it('map a share of the width to milliseconds and back', () => {
			assert.equal(msAt(0.5, 4210), 2105);
			assert.equal(msAt(-0.2, 4210), 0);
			assert.equal(msAt(1.3, 4210), 4210);
			assert.equal(shareOf(2105, 4210), 0.5);
			assert.equal(shareOf(9999, 4210), 1);
		});

		it('treat an empty sound as having no width', () => {
			assert.equal(shareOf(0, 0), 0);
		});
	});

	describe('nearerHandle', () => {
		it('picks the handle closer to the point, the start on a tie', () => {
			assert.equal(nearerHandle(100, 200, 800), 'start');
			assert.equal(nearerHandle(900, 200, 800), 'end');
			assert.equal(nearerHandle(400, 200, 800), 'start');
			assert.equal(nearerHandle(600, 200, 800), 'end');
			assert.equal(nearerHandle(500, 200, 800), 'start');
		});

		it('picks the handle on the side of the point when the handles are as close as they can be', () => {
			assert.equal(nearerHandle(980, 990, 1000), 'start');
			assert.equal(nearerHandle(1000, 990, 1000), 'end');
		});
	});

	describe('stepFor', () => {
		it('steps 10 ms with the arrow keys and 100 ms with Shift', () => {
			assert.equal(stepFor('ArrowRight', false), 10);
			assert.equal(stepFor('ArrowUp', false), 10);
			assert.equal(stepFor('ArrowLeft', false), -10);
			assert.equal(stepFor('ArrowDown', true), -100);
			assert.equal(stepFor('ArrowRight', true), 100);
			assert.equal(stepFor('Enter', false), null);
		});
	});

	describe('stored values', () => {
		it('stores an end at the duration as null, so the sound plays to the end of its file', () => {
			assert.equal(toStoredEnd(4210, 4210), null);
			assert.equal(toStoredEnd(4209, 4210), 4.209);
		});

		it('reads stored points as milliseconds that fit the duration', () => {
			assert.deepEqual(fromStored({ startAt: 0.25, endAt: null }, 4210), { startMs: 250, endMs: 4210 });
			assert.deepEqual(fromStored({ startAt: 1.0004, endAt: 2.5 }, 4210), { startMs: 1000, endMs: 2500 });
			assert.deepEqual(fromStored({ startAt: 3, endAt: 9 }, 4210), { startMs: 3000, endMs: 4210 });
			assert.deepEqual(fromStored({ startAt: 9, endAt: null }, 4210), { startMs: 4200, endMs: 4210 });
		});
	});

	describe('formatMs and parseMs', () => {
		it('formats milliseconds with thousands separators', () => {
			assert.equal(formatMs(4210), '4,210 ms');
			assert.equal(formatMs(250), '250 ms');
		});

		it('reads whole milliseconds, with or without separators and a unit', () => {
			assert.equal(parseMs('1250'), 1250);
			assert.equal(parseMs(' 1,250 ms '), 1250);
			assert.equal(parseMs('1 250'), 1250);
			assert.equal(parseMs('0'), 0);
		});

		it('rejects anything else', () => {
			for (const text of ['', 'abc', '-5', '1.5', '12 s', '1,2,']) {
				assert.equal(parseMs(text), null, text);
			}
		});
	});
});
