import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccessControl, MAX_REQUESTS, normalizeAddress, RATE_WINDOW_MS, REQUEST_LIFETIME_MS } from '../../../src/http/access-control.js';

const PHONE = '192.168.1.50';
const TABLET = '192.168.1.51';

/** @param {number[]} [numbers] what `randomNumber` answers, in order, before it runs out of ideas */
function setup(numbers = []) {
	let now = 0;
	let secrets = 0;
	let codes = 0;
	const queue = [...numbers];
	const control = new AccessControl({
		now: () => now,
		randomNumber: () => queue.shift() ?? 500 + codes++,
		randomSecret: () => `secret-${++secrets}`,
	});
	/** @param {number} ms */
	const advance = (ms) => {
		now += ms;
	};
	return { control, advance };
}

describe('AccessControl', () => {
	describe('pairing', () => {
		it('gives a device a three-digit code and lists its request', () => {
			const { control } = setup([7]);
			assert.deepEqual(control.request(PHONE), { status: 'pending', code: '007' });
			assert.deepEqual(control.pending(), [{ address: PHONE, code: '007' }]);
		});

		it('returns the same code when the same address asks again, such as from a second tab', () => {
			const { control } = setup([123, 456]);
			assert.deepEqual(control.request(PHONE), { status: 'pending', code: '123' });
			assert.deepEqual(control.request(PHONE), { status: 'pending', code: '123' });
			assert.equal(control.pending().length, 1);
		});

		it('tells a new request from a repeated one', () => {
			const { control } = setup([1]);
			/** @type {string[]} */
			const heard = [];
			control.onRequest(({ address, code }) => heard.push(`${address} ${code}`));
			control.request(PHONE);
			control.request(PHONE);
			assert.deepEqual(heard, [`${PHONE} 001`]);
		});

		it('never gives two pending requests the same code', () => {
			const { control } = setup([5, 5, 5, 6]);
			assert.equal(/** @type {{ code: string }} */ (control.request(PHONE)).code, '005');
			assert.equal(/** @type {{ code: string }} */ (control.request(TABLET)).code, '006');
		});

		it('reads an IPv6-mapped address as the IPv4 one', () => {
			const { control } = setup([1]);
			control.request(`::ffff:${PHONE}`);
			assert.deepEqual(control.status(PHONE), { status: 'pending', code: '001' });
			assert.equal(normalizeAddress('::ffff:10.0.0.2'), '10.0.0.2');
			assert.equal(normalizeAddress('fe80::1'), 'fe80::1');
		});

		it('says there is nothing for an address that never asked', () => {
			assert.deepEqual(setup().control.status(PHONE), { status: 'none' });
		});
	});

	describe('answering', () => {
		it('allows a device, hands its secret over once and then recognizes it', () => {
			const { control } = setup([9]);
			control.request(PHONE);
			assert.equal(control.answer(PHONE, 'allow'), true);
			assert.deepEqual(control.pending(), []);
			assert.deepEqual(control.status(PHONE), { status: 'allowed', code: '009', secret: 'secret-1' });
			assert.deepEqual(control.status(PHONE), { status: 'allowed', code: '009' });
			assert.equal(control.isAllowed('secret-1'), true);
			assert.equal(control.isAllowed('secret-2'), false);
			assert.equal(control.isAllowed(''), false);
		});

		it('denies a device without giving it a secret', () => {
			const { control } = setup([9]);
			control.request(PHONE);
			assert.equal(control.answer(PHONE, 'deny'), true);
			assert.deepEqual(control.status(PHONE), { status: 'denied', code: '009' });
			assert.deepEqual(control.pending(), []);
		});

		it('answers only a request that is waiting', () => {
			const { control } = setup();
			assert.equal(control.answer(PHONE, 'allow'), false);
			control.request(PHONE);
			control.answer(PHONE, 'deny');
			assert.equal(control.answer(PHONE, 'allow'), false);
			assert.equal(control.isAllowed('secret-1'), false);
		});

		it('starts a new request when a device that was denied asks again', () => {
			const { control } = setup([1, 2]);
			control.request(PHONE);
			control.answer(PHONE, 'deny');
			assert.deepEqual(control.request(PHONE), { status: 'pending', code: '002' });
		});

		it('tells the pages whenever the list of requests changes', () => {
			const { control } = setup();
			let changes = 0;
			const stop = control.onChange(() => changes++);
			control.request(PHONE);
			control.request(PHONE);
			assert.equal(changes, 1);
			control.answer(PHONE, 'allow');
			assert.equal(changes, 2);
			stop();
			control.request(TABLET);
			assert.equal(changes, 2);
		});
	});

	describe('expiry', () => {
		it('forgets a request nobody answered, and tells the pages', () => {
			const { control, advance } = setup();
			let changes = 0;
			control.onChange(() => changes++);
			control.request(PHONE);
			advance(REQUEST_LIFETIME_MS);
			assert.deepEqual(control.pending(), []);
			assert.deepEqual(control.status(PHONE), { status: 'none' });
			assert.equal(control.answer(PHONE, 'allow'), false);
			assert.equal(changes, 2);
		});

		it('keeps a request that is still young', () => {
			const { control, advance } = setup();
			control.request(PHONE);
			advance(REQUEST_LIFETIME_MS - 1);
			assert.equal(control.pending().length, 1);
		});

		it('forgets an answer the phone never collected, but not the device it allowed', () => {
			const { control, advance } = setup();
			control.request(PHONE);
			control.answer(PHONE, 'allow');
			advance(REQUEST_LIFETIME_MS);
			assert.deepEqual(control.status(PHONE), { status: 'none' });
		});
	});

	describe('the limit', () => {
		it('bans an address that asks more than five times within a minute', () => {
			const { control } = setup();
			for (let i = 0; i < MAX_REQUESTS; i++) {
				assert.equal(control.request(PHONE).status, 'pending');
			}
			assert.deepEqual(control.request(PHONE), { status: 'banned' });
			assert.equal(control.isBanned(PHONE), true);
			assert.deepEqual(control.status(PHONE), { status: 'banned' });
			assert.deepEqual(control.pending(), []);
			assert.equal(control.isBanned(TABLET), false);
		});

		it('keeps a banned address banned however long it waits', () => {
			const { control, advance } = setup();
			while (!control.strike(PHONE)) {
				// Asking until it is banned.
			}
			advance(10 * RATE_WINDOW_MS);
			assert.equal(control.request(PHONE).status, 'banned');
		});

		it('forgets requests older than a minute', () => {
			const { control, advance } = setup();
			for (let i = 0; i < MAX_REQUESTS; i++) {
				control.request(PHONE);
				advance(RATE_WINDOW_MS / MAX_REQUESTS + 1);
			}
			assert.equal(control.request(PHONE).status, 'pending');
			assert.equal(control.isBanned(PHONE), false);
		});

		it('counts the two spellings of an address together', () => {
			const { control } = setup();
			for (let i = 0; i < MAX_REQUESTS; i++) {
				control.request(i % 2 === 0 ? PHONE : `::ffff:${PHONE}`);
			}
			assert.equal(control.strike(PHONE), true);
		});

		it('does not count asking for the answer', () => {
			const { control } = setup();
			control.request(PHONE);
			for (let i = 0; i < 100; i++) {
				control.status(PHONE);
			}
			assert.equal(control.isBanned(PHONE), false);
		});
	});
});
