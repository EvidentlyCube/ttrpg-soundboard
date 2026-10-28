import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ChangeWatcher, POLL_MS, QUIET_MS } from '../../../src/library/change-watcher.js';
import { scanAudioDirectory } from '../../../src/library/scanner.js';
import { FakeClock } from '../../helpers/fake-clock.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
/** @type {ChangeWatcher[]} */
const watchers = [];
afterEach(async () => {
	for (const watcher of watchers.splice(0)) {
		watcher.stop();
	}
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** Stands in for `fs.watch`: the test fires its events and errors. */
class FakeWatch {
	/** @type {(() => void) | null} */
	listener = null;
	/** @type {((error: Error) => void) | null} */
	onError = null;
	closed = false;
	/** @type {Error | null} */
	throwOnStart = null;

	/** @type {import('../../../src/library/change-watcher.js').WatchFunction} */
	watch = (_root, _options, listener) => {
		if (this.throwOnStart) {
			throw this.throwOnStart;
		}
		this.listener = listener;
		return {
			on: (_event, onError) => {
				this.onError = onError;
			},
			close: () => {
				this.closed = true;
			},
		};
	};

	fire() {
		this.listener?.();
	}
}

/** @param {{ watchFails?: Error }} [options] */
async function setup({ watchFails } = {}) {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Boom.mp3': 'boom',
		'Combat': { '1.mp3': 'one' },
	});
	trees.push(tree);
	const root = tree.root;
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(root);
	assert.equal(outcome.status, 'ready');

	const clock = new FakeClock();
	const fakeWatch = new FakeWatch();
	fakeWatch.throwOnStart = watchFails ?? null;
	/** @type {string[]} */
	const logged = [];
	const watcher = new ChangeWatcher({ root, log: (message) => logged.push(message), watch: fakeWatch.watch, timers: clock });
	watchers.push(watcher);
	/** @type {boolean[]} */
	const announced = [];
	watcher.onChange((changed) => announced.push(changed));
	await watcher.start(outcome.scan);

	/** Waits until everything the watcher queued so far has run; a rebuild without a scan changes nothing. */
	const idle = () => watcher.refresh(async () => ({ status: 'idle' }));
	/** @param {number} milliseconds */
	const advance = async (milliseconds) => {
		clock.advance(milliseconds);
		await idle();
	};
	return { root, scan: outcome.scan, clock, fakeWatch, logged, watcher, announced, idle, advance };
}

/** @param {string} path */
async function touch(path) {
	const later = new Date(Date.now() + 60_000);
	await utimes(path, later, later);
}

describe('ChangeWatcher', () => {
	describe('starting', () => {
		it('starts without changes and watches the root recursively', async () => {
			const { watcher, fakeWatch } = await setup();
			assert.equal(watcher.externalChanges, false);
			assert.notEqual(fakeWatch.listener, null);
		});

		it('reports files that changed while bootstrap was running', async () => {
			const tree = await createTmpTree({ '.soundboard': JSON.stringify({ version: 1 }), 'Boom.mp3': 'boom' });
			trees.push(tree);
			const scan = await scanAudioDirectory(tree.root);
			await writeFile(join(tree.root, 'Late.mp3'), 'late');
			const watcher = new ChangeWatcher({ root: tree.root, log: () => {}, watch: new FakeWatch().watch, timers: new FakeClock() });
			watchers.push(watcher);
			await watcher.start(scan);
			assert.equal(watcher.externalChanges, true);
		});
	});

	describe('file system events', () => {
		it('compares the directory once it has been quiet for a second', async () => {
			const { root, fakeWatch, watcher, announced, advance } = await setup();
			await writeFile(join(root, 'New.mp3'), 'new');
			fakeWatch.fire();
			await advance(QUIET_MS - 1);
			assert.equal(watcher.externalChanges, false);
			await advance(1);
			assert.equal(watcher.externalChanges, true);
			assert.deepEqual(announced, [true]);
		});

		it('waits again after every event, so a copy in progress is compared once it stops', async () => {
			const { root, fakeWatch, watcher, advance } = await setup();
			await writeFile(join(root, 'New.mp3'), 'n');
			fakeWatch.fire();
			await advance(QUIET_MS - 100);
			fakeWatch.fire();
			await advance(QUIET_MS - 100);
			assert.equal(watcher.externalChanges, false);
			await advance(100);
			assert.equal(watcher.externalChanges, true);
		});

		it('ignores a file touched without changing its content', async () => {
			const { root, fakeWatch, watcher, advance } = await setup();
			await touch(join(root, 'Boom.mp3'));
			fakeWatch.fire();
			await advance(QUIET_MS);
			assert.equal(watcher.externalChanges, false);
		});

		it('counts a file whose content changed', async () => {
			const { root, fakeWatch, watcher, advance } = await setup();
			await writeFile(join(root, 'Boom.mp3'), 'bang');
			await touch(join(root, 'Boom.mp3'));
			fakeWatch.fire();
			await advance(QUIET_MS);
			assert.equal(watcher.externalChanges, true);
		});

		it('ignores events about files the app does not read', async () => {
			const { root, fakeWatch, watcher, advance } = await setup();
			await writeFile(join(root, 'Boom.mp3.wf'), 'waveform');
			fakeWatch.fire();
			await advance(QUIET_MS);
			assert.equal(watcher.externalChanges, false);
		});
	});

	describe('quick checks', () => {
		it('finds nothing when nothing changed', async () => {
			const { watcher } = await setup();
			assert.equal(await watcher.check(), false);
		});

		it('compares sizes and dates only, so a touched file counts', async () => {
			const { root, watcher, announced } = await setup();
			await touch(join(root, 'Boom.mp3'));
			assert.equal(await watcher.check(), true);
			assert.deepEqual(announced, [true]);
		});

		it('reports a directory it can no longer read as changed and logs why', async () => {
			const { root, watcher, logged } = await setup();
			await rm(root, { recursive: true });
			assert.equal(await watcher.check(), true);
			assert.match(logged.join('\n'), /Checking the audio directory failed/);
		});
	});

	describe('own writes', () => {
		it('never counts a file the app saved itself', async () => {
			const { root, fakeWatch, watcher, advance } = await setup();
			await watcher.updateFile(join(root, 'Boom.mp3.json'), (current) => ({ ...current, title: 'Big Boom' }));
			await watcher.updateFile(join(root, '.soundboard'), (current) => ({ ...current, volumes: { music: 0.5 } }));
			fakeWatch.fire();
			await advance(QUIET_MS);
			assert.equal(watcher.externalChanges, false);
			assert.equal(await watcher.check(), false);
			assert.equal(JSON.parse(await readFile(join(root, 'Boom.mp3.json'), 'utf8')).title, 'Big Boom');
		});

		it('never counts files a task created and listed', async () => {
			const { root, fakeWatch, watcher, advance } = await setup();
			const written = [join(root, 'New.ogg'), join(root, 'New.ogg.json')];
			const result = await watcher.writeFiles(async () => {
				await writeFile(written[0], 'new');
				await writeFile(written[1], '{}');
				return { written, value: 7 };
			});
			assert.equal(result.value, 7);
			fakeWatch.fire();
			await advance(QUIET_MS);
			assert.equal(watcher.externalChanges, false);
			assert.equal(await watcher.check(), false);
		});

		it('runs such a task only after a rebuild queued before it', async () => {
			const { watcher } = await setup();
			/** @type {string[]} */
			const order = [];
			const rebuild = watcher.refresh(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				order.push('rebuild');
				return { status: 'idle' };
			});
			const task = watcher.writeFiles(async () => {
				order.push('task');
				return { written: [] };
			});
			await Promise.all([rebuild, task]);
			assert.deepEqual(order, ['rebuild', 'task']);
		});
	});

	describe('when the directory cannot be watched', () => {
		it('checks sizes and dates every 30 seconds instead, and says so', async () => {
			const { root, watcher, logged, advance } = await setup({ watchFails: new Error('ENOSPC') });
			assert.match(logged.join('\n'), /Can't watch the audio directory \(ENOSPC\); checking it every 30 seconds instead/);
			await touch(join(root, 'Boom.mp3'));
			await advance(POLL_MS - 1);
			assert.equal(watcher.externalChanges, false);
			await advance(1);
			assert.equal(watcher.externalChanges, true);
		});

		it('falls back the same way when watching fails later', async () => {
			const { root, fakeWatch, watcher, logged, advance } = await setup();
			fakeWatch.onError?.(new Error('too many files'));
			assert.equal(fakeWatch.closed, true);
			assert.equal(logged.length, 1);
			await writeFile(join(root, 'New.mp3'), 'new');
			await advance(POLL_MS);
			assert.equal(watcher.externalChanges, true);
		});
	});

	describe('refresh', () => {
		it('takes a new baseline after a successful rebuild and clears the changes', async () => {
			const { root, watcher, announced } = await setup();
			await writeFile(join(root, 'New.mp3'), 'new');
			assert.equal(await watcher.check(), true);
			const outcome = await watcher.refresh(async () => ({ status: 'ready', scan: await scanAudioDirectory(root) }));
			assert.equal(outcome.status, 'ready');
			assert.equal(watcher.externalChanges, false);
			assert.deepEqual(announced, [true, false]);
		});

		it('keeps the changes when the rebuild failed', async () => {
			const { root, watcher } = await setup();
			await writeFile(join(root, 'New.mp3'), 'new');
			await watcher.check();
			await watcher.refresh(async () => ({ status: 'invalid' }));
			assert.equal(watcher.externalChanges, true);
		});

		it('runs no comparison in the middle of a rebuild', async () => {
			const { root, watcher } = await setup();
			/** @type {string[]} */
			const order = [];
			const rebuilding = watcher.refresh(async () => {
				order.push('rebuild started');
				// What bootstrap does during a refresh: it writes files.
				await writeFile(join(root, 'Boom.mp3.json'), JSON.stringify({ title: 'Rewritten' }));
				order.push('rebuild finished');
				return { status: 'ready', scan: await scanAudioDirectory(root) };
			});
			const checking = watcher.check().then((changed) => order.push(`checked: ${changed}`));
			await Promise.all([rebuilding, checking]);
			assert.deepEqual(order, ['rebuild started', 'rebuild finished', 'checked: false']);
		});
	});

	it('notices a new file with the real fs.watch', async () => {
		const tree = await createTmpTree({ '.soundboard': JSON.stringify({ version: 1 }), 'Combat': { '1.mp3': 'one' } });
		trees.push(tree);
		const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
		assert.equal(outcome.status, 'ready');
		const watcher = new ChangeWatcher({ root: tree.root, log: () => {} });
		watchers.push(watcher);
		await watcher.start(outcome.scan);
		const changed = new Promise((resolve) => watcher.onChange(resolve));
		await writeFile(join(tree.root, 'Combat', '2.mp3'), 'two');
		assert.equal(await changed, true);
	});

	it('cancels its timers when stopped', async () => {
		const { clock, fakeWatch, watcher } = await setup();
		fakeWatch.fire();
		watcher.stop();
		assert.equal(clock.pendingTimerCount, 0);
		assert.equal(fakeWatch.closed, true);
	});
});
