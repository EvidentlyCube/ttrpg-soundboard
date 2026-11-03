import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STARTUP_POLL_MS, StartupFlow } from '../../public/app/logic/startup-flow.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {import('../../public/app/logic/startup-flow.js').StartupState} StartupState */
/** @typedef {import('../../public/app/logic/startup-flow.js').FolderListing} FolderListing */
/** @typedef {import('../../public/app/logic/startup-flow.js').StartupApi} StartupApi */

/** Lets pending promise callbacks run. */
function settle() {
	return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {Partial<StartupState>} [changes]
 * @returns {StartupState}
 */
function state(changes = {}) {
	return {
		phase: 'selecting',
		paths: null,
		recent: [],
		initializer: null,
		tools: { app: '1.0.0', checking: false, ytDlp: { version: null, update: null }, ffmpeg: null },
		...changes,
	};
}

/**
 * @param {string} path
 * @returns {FolderListing}
 */
function listing(path) {
	return { path, parent: '/home', folders: [], audioFiles: 0, files: [], soundboard: false, allowed: true, reason: null };
}

/**
 * A flow for the Selector over an API whose answers the test sets.
 * @param {{ phase?: 'selecting' | 'initializing', browsed?: string | null }} [options]
 */
function setup({ phase = 'selecting', browsed = null } = {}) {
	const clock = new FakeClock();
	/** @type {StartupState | Error} */
	let current = state({ phase });
	/** @type {string[]} */
	const calls = [];
	/** @type {Map<string, FolderListing | Error>} */
	const folders = new Map();
	/** @type {Error | null} */
	let failure = null;
	/** @param {string} name */
	const act = async (name) => {
		calls.push(name);
		if (failure) {
			throw failure;
		}
	};
	/** @type {StartupApi} */
	const api = {
		fetchState: async () => {
			if (current instanceof Error) {
				throw current;
			}
			return current;
		},
		fetchPlaces: async () => ({ places: [{ name: 'Home', path: '/home/ana' }, { name: 'Music', path: '/home/ana/Music' }], browsed }),
		listFolder: async (path) => {
			calls.push(`list ${path}`);
			const answer = folders.get(path) ?? listing(path);
			if (answer instanceof Error) {
				throw answer;
			}
			return answer;
		},
		select: (path) => act(`select ${path}`),
		answer: (id, yes) => act(`answer ${id} ${yes}`),
		back: () => act('back'),
		retry: () => act('retry'),
		deleteAndRetry: () => act('deleteAndRetry'),
		forgetRecent: (path) => act(`forget ${path}`),
	};
	let left = 0;
	/** @type {import('../../public/app/logic/startup-flow.js').StartupView[]} */
	const views = [];
	const flow = new StartupFlow({ api, clock, phase, onChange: (view) => views.push(view), onLeave: () => left++ });
	return {
		flow,
		clock,
		calls,
		folders,
		views,
		left: () => left,
		/** @param {StartupState | Error} next */
		setState: (next) => {
			current = next;
		},
		/** @param {Error | null} next */
		failActions: (next) => {
			failure = next;
		},
	};
}

describe('StartupFlow', () => {
	it('asks for the state at once and then every poll interval', async () => {
		const { flow, clock, views, setState } = setup();
		flow.start();
		await settle();
		assert.equal(flow.view.state?.phase, 'selecting');
		setState(state({ recent: [{ path: '/home/ana/board', name: 'board', exists: true }] }));
		clock.advance(STARTUP_POLL_MS);
		await settle();
		assert.equal(flow.view.state?.recent.length, 1);
		assert.ok(views.length >= 2);
		flow.stop();
		assert.equal(clock.pendingTimerCount, 0);
	});

	it('says when the server doesn’t answer, and recovers when it does again', async () => {
		const { flow, clock, setState } = setup();
		setState(new Error('offline'));
		flow.start();
		await settle();
		assert.equal(flow.view.connected, false);
		setState(state());
		clock.advance(STARTUP_POLL_MS);
		await settle();
		assert.equal(flow.view.connected, true);
	});

	it('leaves once the server is in another phase, and stops polling', async () => {
		const { flow, clock, left, setState } = setup();
		flow.start();
		await settle();
		setState(state({ phase: 'initializing' }));
		clock.advance(STARTUP_POLL_MS);
		await settle();
		assert.equal(left(), 1);
		assert.equal(clock.pendingTimerCount, 0);
	});

	it('loads the starting places, then shows the first of them', async () => {
		const { flow, calls } = setup();
		await flow.browseStart();
		assert.deepEqual(flow.view.places.map((place) => place.name), ['Home', 'Music']);
		assert.equal(flow.view.listing?.path, '/home/ana');
		assert.deepEqual(calls, ['list /home/ana']);
	});

	it('shows the folder browsed last instead of the first place', async () => {
		const { flow, calls } = setup({ browsed: '/home/ana/Music/Battle' });
		await flow.browseStart();
		assert.equal(flow.view.listing?.path, '/home/ana/Music/Battle');
		assert.deepEqual(calls, ['list /home/ana/Music/Battle']);
	});

	it('quietly falls back to the first place when the folder browsed last can’t be shown any more', async () => {
		const { flow, calls, folders } = setup({ browsed: '/mnt/old' });
		folders.set('/mnt/old', new Error('This folder is outside the folders the app may open.'));
		await flow.browseStart();
		assert.equal(flow.view.listing?.path, '/home/ana');
		assert.deepEqual(calls, ['list /mnt/old', 'list /home/ana']);
		assert.equal(flow.view.browseError, null);
		assert.equal(flow.view.browseFailures, 0);
		assert.equal(flow.view.error, null);
	});

	it('keeps the folder shown when another can’t be, and counts each refusal', async () => {
		const { flow, folders } = setup();
		await flow.browse('/home/ana');
		folders.set('/etc', new Error('This folder is outside the folders the app may open.'));
		await flow.browse('/etc');
		assert.equal(flow.view.listing?.path, '/home/ana');
		assert.equal(flow.view.browseError?.message, 'This folder is outside the folders the app may open.');
		assert.equal(flow.view.browseFailures, 1);
		assert.equal(flow.view.error, null);
		await flow.browse('/etc');
		assert.equal(flow.view.browseFailures, 2);
	});

	it('shows only the folder asked for last when answers come back out of order', async () => {
		const { flow, folders } = setup();
		/** @type {(listing: FolderListing) => void} */
		let slow = () => {};
		const pending = new Promise((resolve) => {
			slow = resolve;
		});
		folders.set('/slow', /** @type {any} */ ({ then: (/** @type {any} */ ...args) => pending.then(...args) }));
		const first = flow.browse('/slow');
		await flow.browse('/fast');
		slow(listing('/slow'));
		await first;
		assert.equal(flow.view.listing?.path, '/fast');
	});

	it('sends each action, then asks for the state at once', async () => {
		const { flow, calls } = setup({ phase: 'initializing' });
		await flow.answer(3, true);
		await flow.back();
		await flow.retry();
		await flow.deleteAndRetry();
		assert.deepEqual(calls, ['answer 3 true', 'back', 'retry', 'deleteAndRetry']);
		assert.equal(flow.view.state?.phase, 'initializing');
	});

	it('shows an action’s failure until the next action, and ignores a second action while one runs', async () => {
		const { flow, calls, failActions } = setup();
		failActions(new Error('No audio files found here.'));
		await flow.select('/home/ana/empty');
		assert.equal(flow.view.error?.message, 'No audio files found here.');
		assert.equal(flow.view.busy, false);
		failActions(null);
		const first = flow.select('/home/ana/board');
		const second = flow.forgetRecent('/home/ana/board');
		assert.equal(flow.view.busy, true);
		await Promise.all([first, second]);
		assert.equal(flow.view.error, null);
		assert.deepEqual(calls, ['select /home/ana/empty', 'select /home/ana/board']);
	});
});
