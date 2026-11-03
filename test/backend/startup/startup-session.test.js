import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	LARGE_FOLDER_QUESTION,
	METADATA_TITLES_QUESTION,
	NESTED_DIRECTORIES_QUESTION,
} from '../../../src/library/bootstrap-service.js';
import { ValidationError } from '../../../src/library/errors.js';
import { FolderRefusedError, StartupStateError } from '../../../src/startup/errors.js';
import { NO_AUDIO_REASON, OUTSIDE_REASON } from '../../../src/startup/folder-rules.js';
import { RecentFolders } from '../../../src/startup/recent-folders.js';
import { ONLY_GIVEN_PATHS, StartupSession } from '../../../src/startup/startup-session.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @typedef {import('../../../src/startup/startup-session.js').OpenOutcome} OpenOutcome */
/** @typedef {import('../../../src/startup/startup-session.js').Opener} Opener */
/** @typedef {Parameters<Opener>[1]} Ports */

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** Lets pending promise callbacks run. */
function settle() {
	return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Waits until something is true, for steps that write files, such as remembering the folder before becoming ready.
 * @param {() => boolean} condition
 */
async function waitFor(condition) {
	const deadline = Date.now() + 2000;
	while (!condition()) {
		if (Date.now() > deadline) {
			assert.fail('Timed out waiting');
		}
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

/**
 * A session over a temporary tree with two folders that may be opened, `board` and `other`, and one that may not.
 * `open` is what loading a folder does; by default it opens at once.
 * @param {{ open?: Opener, paths?: string[] | null, toolsReady?: Promise<unknown> }} [options]
 */
async function setup({ open, paths = null, toolsReady = Promise.resolve() } = {}) {
	const created = await createTmpTree({
		board: { 'Boom.mp3': '' },
		other: { 'Rain.ogg': '' },
		empty: {},
		config: {},
	});
	trees.push(created);
	const root = await realpath(created.root);
	/** @type {string[]} */
	const closed = [];
	/** @type {string[]} */
	const deleted = [];
	/** @type {unknown[]} */
	const errors = [];
	/** @type {string[]} */
	const opened = [];
	const board = (/** @type {string} */ folder) => ({
		handle: async () => {},
		close: async () => {
			closed.push(folder);
		},
	});
	const recent = new RecentFolders(join(root, 'config', 'recent.json'));
	const session = new StartupSession({
		paths: paths && paths.map((path) => join(root, path)),
		recent,
		platform: { name: 'linux', home: '/nowhere', roots: [root], allowHidden: false },
		open: async (folder, ports) => {
			opened.push(folder);
			return open ? open(folder, ports) : { status: 'ready', start: async () => board(folder) };
		},
		toolsReady,
		logError: (error) => errors.push(error),
		deleteFile: async (path) => {
			deleted.push(path);
		},
	});
	return { session, root, recent, closed, deleted, errors, opened, board };
}

/**
 * An opener that asks the given questions, reporting their details first, and opens when all were answered yes.
 * @param {(ports: Ports) => Promise<boolean>[]} ask
 * @param {(folder: string) => import('../../../src/startup/startup-session.js').Board} board
 * @returns {Opener}
 */
function asking(ask, board) {
	return async (folder, ports) => {
		for (const answer of ask(ports)) {
			if (!(await answer)) {
				return { status: 'cancelled' };
			}
		}
		return { status: 'ready', start: async () => board(folder) };
	};
}

describe('StartupSession', () => {
	it('starts in the Selector and opens a chosen folder, remembering it', async () => {
		const { session, root, recent } = await setup();
		assert.equal(session.phase, 'selecting');
		assert.equal(session.board, null);
		await session.select(join(root, 'board'));
		await waitFor(() => session.phase === 'ready');
		assert.notEqual(session.board, null);
		assert.deepEqual((await recent.list()).map((folder) => folder.path), [join(root, 'board')]);
		const state = await session.state();
		assert.equal(state.phase, 'ready');
		assert.equal(state.initializer, null);
		assert.deepEqual(state.recent, [{ path: join(root, 'board'), name: 'board', exists: true }]);
	});

	it('refuses a folder the rules refuse, a relative path, and choosing while a folder loads', async () => {
		/** @type {(outcome: OpenOutcome) => void} */
		let finish = () => {};
		const { session, root } = await setup({ open: () => new Promise((resolve) => {
			finish = resolve;
		}) });
		await assert.rejects(session.select(join(root, 'empty')), new FolderRefusedError(NO_AUDIO_REASON, 'folder.noAudio'));
		await assert.rejects(session.select('/'), new FolderRefusedError(OUTSIDE_REASON, 'folder.outside'));
		await assert.rejects(session.select('board'), FolderRefusedError);
		await session.select(join(root, 'board'));
		assert.equal(session.phase, 'initializing');
		await assert.rejects(session.select(join(root, 'other')), StartupStateError);
		finish({ status: 'cancelled' });
	});

	it('offers only the folders given on the command line, each with whether it may be opened', async () => {
		const { session, root } = await setup({ paths: ['board', 'empty'] });
		const state = await session.state();
		assert.deepEqual(state.paths, [
			{ path: join(root, 'board'), name: 'board', allowed: true, reason: null, reasonCode: null },
			{ path: join(root, 'empty'), name: 'empty', allowed: false, reason: NO_AUDIO_REASON, reasonCode: 'folder.noAudio' },
		]);
		assert.deepEqual(state.recent, []);
		assert.equal(session.hasGivenPaths, true);
		await assert.rejects(session.select(join(root, 'other')), new FolderRefusedError(ONLY_GIVEN_PATHS, 'folder.onlyGiven'));
	});

	it('asks each question with what was reported for it, and goes on with the answer', async () => {
		const { session, root, board } = await setup({
			open: asking((ports) => {
				ports.reporter.largeFolder(6000);
				const large = ports.prompter.confirm(LARGE_FOLDER_QUESTION);
				return [large, large.then(() => {
					ports.reporter.nestedDirectories(['Combat/Boss']);
					return ports.prompter.confirm(NESTED_DIRECTORIES_QUESTION);
				})];
			}, (folder) => board(folder)),
		});
		await session.select(join(root, 'board'));
		await settle();
		const first = (await session.state()).initializer;
		assert.equal(first?.step, 'question');
		assert.deepEqual(first?.question, { id: 1, kind: 'largeFolder', count: 6000 });

		assert.throws(() => session.answer(2, true), StartupStateError);
		session.answer(1, true);
		await settle();
		const second = (await session.state()).initializer;
		assert.deepEqual(second?.question, { id: 2, kind: 'nestedDirectories', paths: ['Combat/Boss'] });
		assert.throws(() => session.answer(1, true), StartupStateError);
		session.answer(2, true);
		await waitFor(() => session.phase === 'ready');
	});

	it('asks about metadata titles, and a No goes back to the Selector', async () => {
		const { session, root, recent } = await setup({
			open: asking((ports) => {
				ports.reporter.metadataTitles([{ path: 'Boom.mp3', title: 'Boom!' }]);
				return [ports.prompter.confirm(METADATA_TITLES_QUESTION)];
			}, () => assert.fail('opened')),
		});
		await session.select(join(root, 'board'));
		await settle();
		const { initializer } = await session.state();
		assert.deepEqual(initializer?.question, { id: 1, kind: 'metadataTitles', titles: [{ path: 'Boom.mp3', title: 'Boom!' }] });
		session.answer(1, false);
		await settle();
		assert.equal(session.phase, 'selecting');
		assert.equal((await session.state()).initializer, null);
		assert.deepEqual(await recent.list(), []);
	});

	it('answers No when going back from a question', async () => {
		const { session, root } = await setup({
			open: asking((ports) => {
				ports.reporter.nestedDirectories(['A/B']);
				return [ports.prompter.confirm(NESTED_DIRECTORIES_QUESTION)];
			}, () => assert.fail('opened')),
		});
		await session.select(join(root, 'board'));
		await settle();
		session.back();
		await settle();
		assert.equal(session.phase, 'selecting');
	});

	it('shows the progress of measuring durations', async () => {
		/** @type {Ports | null} */
		let ports = null;
		const { session, root } = await setup({
			open: (folder, given) => {
				ports = given;
				return new Promise(() => {});
			},
		});
		await session.select(join(root, 'board'));
		await settle();
		const reporter = /** @type {Ports} */ (/** @type {unknown} */ (ports)).reporter;
		reporter.measuringDurations(4);
		assert.deepEqual((await session.state()).initializer?.progress, { done: 0, total: 4 });
		reporter.measured(3, 4);
		const { initializer } = await session.state();
		assert.equal(initializer?.step, 'measuring');
		assert.deepEqual(initializer?.progress, { done: 3, total: 4 });
	});

	it('lists the files that failed validation relative to the folder, and deletes them on request before loading again', async () => {
		let attempt = 0;
		/** @type {string} */
		let folderRoot = '';
		const { session, root, deleted } = await setup({
			open: async (folder) => {
				folderRoot = folder;
				attempt++;
				if (attempt === 1) {
					return {
						status: 'invalid',
						errors: [
							new ValidationError(join(folder, 'Boom.json'), ['invalid JSON']),
							new ValidationError(join(folder, '.soundboard'), ['version: expected 1']),
						],
					};
				}
				return { status: 'ready', start: async () => ({ handle: async () => {}, close: async () => {} }) };
			},
		});
		await session.select(join(root, 'board'));
		await settle();
		const { initializer } = await session.state();
		assert.equal(initializer?.step, 'failed');
		assert.deepEqual(initializer?.failures, [
			{ path: 'Boom.json', problems: ['invalid JSON'] },
			{ path: '.soundboard', problems: ['version: expected 1'] },
		]);
		assert.equal(initializer?.canDelete, true);
		await session.deleteAndRetry();
		await waitFor(() => session.phase === 'ready');
		assert.deepEqual(deleted, [join(folderRoot, 'Boom.json'), join(folderRoot, '.soundboard')]);
	});

	it('never offers to delete a file that isn’t one of the app’s own, or one outside the folder', async () => {
		const { session, root } = await setup({
			open: async (folder) => ({
				status: 'invalid',
				errors: [new ValidationError(join(folder, 'Boom.mp3'), ['odd']), new ValidationError(join(folder, '..', 'x.json'), ['odd'])],
			}),
		});
		await session.select(join(root, 'board'));
		await settle();
		assert.equal((await session.state()).initializer?.canDelete, false);
		await assert.rejects(session.deleteAndRetry(), StartupStateError);
	});

	it('loads again on Try again, and goes back to the Selector on Back, after a failure', async () => {
		let attempt = 0;
		const { session, root, errors } = await setup({
			open: async () => {
				attempt++;
				throw new Error(`Cannot read the folder (${attempt})`);
			},
		});
		await session.select(join(root, 'board'));
		await settle();
		assert.equal((await session.state()).initializer?.error, 'Cannot read the folder (1)');
		assert.equal(errors.length, 1);
		session.retry();
		await settle();
		assert.equal((await session.state()).initializer?.error, 'Cannot read the folder (2)');
		session.back();
		assert.equal(session.phase, 'selecting');
		assert.throws(() => session.retry(), StartupStateError);
	});

	it('refuses Back and Try again while the folder loads', async () => {
		const { session, root } = await setup({ open: () => new Promise(() => {}) });
		await session.select(join(root, 'board'));
		assert.throws(() => session.back(), StartupStateError);
		assert.throws(() => session.retry(), StartupStateError);
	});

	it('waits for the tools before opening the soundboard', async () => {
		/** @type {() => void} */
		let toolsDone = () => {};
		const { session, root } = await setup({ toolsReady: new Promise((resolve) => {
			toolsDone = () => resolve(undefined);
		}) });
		await session.select(join(root, 'board'));
		await settle();
		assert.equal((await session.state()).initializer?.step, 'waitingForTools');
		toolsDone();
		await waitFor(() => session.phase === 'ready');
	});

	it('closes the soundboard and goes back to the Selector, and refuses closing when none is open', async () => {
		const { session, root, closed } = await setup();
		await assert.rejects(session.close(), StartupStateError);
		await session.select(join(root, 'board'));
		await waitFor(() => session.phase === 'ready');
		await session.close();
		assert.equal(session.phase, 'selecting');
		assert.equal(session.board, null);
		assert.deepEqual(closed, [join(root, 'board')]);
	});

	it('closes what is open on shutdown, and is safe to call twice', async () => {
		const { session, root, closed } = await setup();
		await session.shutdown();
		await session.select(join(root, 'board'));
		await waitFor(() => session.phase === 'ready');
		await session.shutdown();
		await session.shutdown();
		assert.deepEqual(closed, [join(root, 'board')]);
	});

	it('closes a soundboard that finished opening after it was abandoned', async () => {
		/** @type {(outcome: OpenOutcome) => void} */
		let finish = () => {};
		const { session, root, closed, board } = await setup({ open: () => new Promise((resolve) => {
			finish = resolve;
		}) });
		await session.select(join(root, 'board'));
		await session.shutdown();
		finish({ status: 'ready', start: async () => board('late') });
		await waitFor(() => closed.length > 0);
		assert.deepEqual(closed, ['late']);
		assert.equal(session.board, null);
	});

	it('forgets a recent folder', async () => {
		const { session, root, recent } = await setup();
		await recent.add(join(root, 'board'));
		await session.forgetRecent(join(root, 'board'));
		assert.deepEqual((await session.state()).recent, []);
	});

	it('names a soundboard by its own name in the recent and the given folders', async () => {
		const { session, root, recent } = await setup();
		await writeFile(join(root, 'board', '.soundboard'), JSON.stringify({ version: 1, name: 'Tavern' }));
		await recent.add(join(root, 'board'));
		assert.equal((await session.state()).recent[0].name, 'Tavern');
		const given = await setup({ paths: ['board'] });
		await writeFile(join(given.root, 'board', '.soundboard'), JSON.stringify({ version: 1, name: 'Tavern' }));
		assert.equal((await given.session.state()).paths?.[0].name, 'Tavern');
	});
});
