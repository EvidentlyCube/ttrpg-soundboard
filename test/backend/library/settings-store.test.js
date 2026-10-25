import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ValidationError } from '../../../src/library/errors.js';
import { INITIAL_SETTINGS_FILE, SettingsStore } from '../../../src/library/settings-store.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
let tree;
/** @type {string} */
let path;
beforeEach(async () => {
	tree = await createTmpTree({});
	path = join(tree.root, '.soundboard');
});
afterEach(() => tree.remove());

/** @param {unknown} content */
async function writeSettings(content) {
	await writeFile(path, JSON.stringify(content));
}

async function readSettings() {
	return JSON.parse(await readFile(path, 'utf8'));
}

/** @returns {{ promise: Promise<void>, resolve: () => void, reject: (error: Error) => void }} */
function deferred() {
	/** @type {() => void} */
	let resolve = () => {};
	/** @type {(error: Error) => void} */
	let reject = () => {};
	/** @type {Promise<void>} */
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('INITIAL_SETTINGS_FILE', () => {
	it('is version 1 with every volume at 1', () => {
		assert.deepEqual(INITIAL_SETTINGS_FILE, { version: 1, volumes: { master: 1, music: 1, sfx: 1 } });
	});
});

describe('SettingsStore', () => {
	it('fills in default volumes for missing buses', async () => {
		await writeSettings({ version: 1, volumes: { music: 0.4 } });
		const store = await SettingsStore.load(path);
		assert.deepEqual(store.settings, { volumes: { master: 1, music: 0.4, sfx: 1 } });
	});

	it('rejects an invalid settings file', async () => {
		await writeSettings({ version: 1, volumes: { music: 4 } });
		await assert.rejects(SettingsStore.load(path), ValidationError);
	});

	it('merges a partial volume update and saves it, keeping unknown keys', async () => {
		await writeSettings({ version: 1, volumes: { master: 0.9 }, futureKey: 'kept' });
		const store = await SettingsStore.load(path);

		const settings = await store.updateVolumes({ sfx: 0.25 });

		assert.deepEqual(settings, { volumes: { master: 0.9, music: 1, sfx: 0.25 } });
		assert.deepEqual(await readSettings(), {
			version: 1,
			volumes: { master: 0.9, music: 1, sfx: 0.25 },
			futureKey: 'kept',
		});
	});

	it('ignores unknown volume keys', async () => {
		await writeSettings({ version: 1 });
		const store = await SettingsStore.load(path);
		await store.updateVolumes(/** @type {any} */ ({ music: 0.5, extra: 0.1 }));
		assert.deepEqual(store.settings, { volumes: { master: 1, music: 0.5, sfx: 1 } });
	});

	it('rejects invalid volumes without changing anything', async () => {
		await writeSettings({ version: 1 });
		const store = await SettingsStore.load(path);
		await assert.rejects(store.updateVolumes({ music: 0.5, sfx: 2 }), ValidationError);
		assert.deepEqual(store.settings, { volumes: { master: 1, music: 1, sfx: 1 } });
		assert.deepEqual(await readSettings(), { version: 1 });
	});

	it('writes one save at a time and coalesces changes made during a save', async () => {
		/** @type {ReturnType<typeof deferred>[]} */
		const writes = [];
		/** @type {unknown[]} */
		const written = [];
		let concurrent = 0;
		const store = new SettingsStore(path, { volumes: { master: 1, music: 1, sfx: 1 } }, {
			updateFile: async (_path, update) => {
				concurrent++;
				assert.equal(concurrent, 1);
				written.push(update({ version: 1 }));
				const write = deferred();
				writes.push(write);
				await write.promise;
				concurrent--;
			},
		});

		const first = store.updateVolumes({ music: 0.1 });
		const second = store.updateVolumes({ music: 0.2 });
		const third = store.updateVolumes({ sfx: 0.3 });
		assert.equal(writes.length, 1);

		writes[0].resolve();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(writes.length, 2);
		writes[1].resolve();

		await Promise.all([first, second, third]);
		assert.deepEqual(written, [
			{ version: 1, volumes: { master: 1, music: 0.1, sfx: 1 } },
			{ version: 1, volumes: { master: 1, music: 0.2, sfx: 0.3 } },
		]);
	});

	it('reports a failed save and saves again on the next change', async () => {
		let attempts = 0;
		const store = new SettingsStore(path, { volumes: { master: 1, music: 1, sfx: 1 } }, {
			updateFile: async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error('disk full');
				}
			},
		});

		await assert.rejects(store.updateVolumes({ music: 0.5 }), /disk full/);
		assert.deepEqual(store.settings.volumes.music, 0.5);
		await store.updateVolumes({ sfx: 0.5 });
		assert.equal(attempts, 2);
	});
});
