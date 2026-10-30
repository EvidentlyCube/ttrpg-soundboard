import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccessRequester, POLL_MS } from '../../public/app/logic/access-requester.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {import('../../public/app/logic/access-requester.js').PairingAnswer} PairingAnswer */

/**
 * @param {PairingAnswer | Error} first the answer to asking
 * @param {(PairingAnswer | Error)[]} [polls] the answers to the polls, the last one repeating
 */
function setup(first, polls = []) {
	const clock = new FakeClock();
	const queue = [...polls];
	let requests = 0;
	let pollCount = 0;
	/** @param {PairingAnswer | Error} answer */
	const answer = async (answer) => {
		if (answer instanceof Error) {
			throw answer;
		}
		return answer;
	};
	/** @type {import('../../public/app/logic/access-requester.js').RequesterState[]} */
	const states = [];
	const requester = new AccessRequester({
		api: {
			request: () => {
				requests++;
				return answer(first);
			},
			poll: () => {
				pollCount++;
				return answer(queue.length > 1 ? /** @type {PairingAnswer | Error} */ (queue.shift()) : queue[0]);
			},
		},
		clock,
		onChange: (state) => states.push(state),
	});
	return {
		requester,
		clock,
		states,
		counts: () => ({ requests, polls: pollCount }),
		/** Lets the answers that are already on their way arrive. */
		settle: () => new Promise((resolve) => setImmediate(resolve)),
	};
}

describe('AccessRequester', () => {
	it('shows the code of the request while it waits', async () => {
		const { requester, settle } = setup({ status: 'pending', code: '482' }, [{ status: 'pending', code: '482' }]);
		requester.start();
		assert.deepEqual(requester.state, { phase: 'starting', code: null });
		await settle();
		assert.deepEqual(requester.state, { phase: 'pending', code: '482' });
	});

	it('polls once a second until the request is allowed, then stops', async () => {
		const { requester, clock, counts, settle } = setup({ status: 'pending', code: '482' }, [
			{ status: 'pending', code: '482' },
			{ status: 'allowed', code: '482' },
		]);
		requester.start();
		await settle();
		clock.advance(POLL_MS);
		await settle();
		assert.equal(requester.state.phase, 'pending');
		clock.advance(POLL_MS);
		await settle();
		assert.deepEqual(requester.state, { phase: 'allowed', code: '482' });
		clock.advance(10 * POLL_MS);
		await settle();
		assert.deepEqual(counts(), { requests: 1, polls: 2 });
		assert.equal(clock.pendingTimerCount, 0);
	});

	it('ends as denied', async () => {
		const { requester, clock, settle } = setup({ status: 'pending', code: '1' }, [{ status: 'denied', code: '1' }]);
		requester.start();
		await settle();
		clock.advance(POLL_MS);
		await settle();
		assert.deepEqual(requester.state, { phase: 'denied', code: '1' });
		assert.equal(clock.pendingTimerCount, 0);
	});

	it('ends as expired when the server forgets the request', async () => {
		const { requester, clock, settle } = setup({ status: 'pending', code: '1' }, [{ status: 'none' }]);
		requester.start();
		await settle();
		clock.advance(POLL_MS);
		await settle();
		assert.deepEqual(requester.state, { phase: 'expired', code: null });
		assert.equal(clock.pendingTimerCount, 0);
	});

	it('ends as banned, without polling, when asking already got the ban', async () => {
		const { requester, clock, settle } = setup({ status: 'banned' });
		requester.start();
		await settle();
		assert.deepEqual(requester.state, { phase: 'banned', code: null });
		assert.equal(clock.pendingTimerCount, 0);
	});

	it('goes on polling through a failed poll', async () => {
		const { requester, clock, settle } = setup({ status: 'pending', code: '1' }, [
			new Error('offline'),
			{ status: 'allowed', code: '1' },
		]);
		requester.start();
		await settle();
		clock.advance(POLL_MS);
		await settle();
		assert.equal(requester.state.phase, 'pending');
		clock.advance(POLL_MS);
		await settle();
		assert.equal(requester.state.phase, 'allowed');
	});

	it('goes on to poll when asking failed', async () => {
		const { requester, clock, settle } = setup(new Error('offline'), [{ status: 'pending', code: '9' }]);
		requester.start();
		await settle();
		assert.equal(requester.state.phase, 'starting');
		clock.advance(POLL_MS);
		await settle();
		assert.deepEqual(requester.state, { phase: 'pending', code: '9' });
	});

	it('asks again from the start, and ignores answers meant for the earlier ask', async () => {
		const { requester, clock, counts, settle } = setup({ status: 'pending', code: '5' }, [{ status: 'denied', code: '5' }]);
		requester.start();
		await settle();
		clock.advance(POLL_MS);
		await settle();
		assert.equal(requester.state.phase, 'denied');
		requester.start();
		assert.deepEqual(requester.state, { phase: 'starting', code: null });
		await settle();
		assert.equal(counts().requests, 2);
		assert.equal(requester.state.phase, 'pending');
	});

	it('stops polling when stopped', async () => {
		const { requester, clock, counts, settle } = setup({ status: 'pending', code: '5' }, [{ status: 'pending', code: '5' }]);
		requester.start();
		await settle();
		requester.stop();
		clock.advance(5 * POLL_MS);
		await settle();
		assert.equal(counts().polls, 0);
	});
});
