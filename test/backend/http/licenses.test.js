import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { detectRuntime, readLicenses } from '../../../src/http/licenses.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

/** @param {import('../../helpers/tmp-tree.js').TreeSpec} spec */
async function tree(spec) {
	const created = await createTmpTree(spec);
	cleanups.push(() => created.remove());
	return created.root;
}

const NODE = /** @type {const} */ ({ id: 'node', name: 'Node.js', version: '24.22.2', license: 'MIT', url: 'https://github.com/nodejs/node/blob/main/LICENSE' });

describe('detectRuntime', () => {
	it('tells Node.js by its release name, with its version', () => {
		assert.deepEqual(detectRuntime({ versions: { node: '24.14.0' }, release: { name: 'node' } }), { ...NODE, version: '24.14.0' });
	});

	it('tells Bun and Deno apart from the Node.js they pretend to be', () => {
		assert.equal(detectRuntime({ versions: { node: '24.3.0', bun: '1.3.1' }, release: { name: 'node' } })?.name, 'Bun');
		assert.equal(detectRuntime({ versions: { node: '24.3.0', bun: '1.3.1' }, release: { name: 'node' } })?.version, '1.3.1');
		assert.equal(detectRuntime({ versions: { node: '24.2.0', deno: '2.5.0' }, release: { name: 'node' } })?.name, 'Deno');
	});

	it('gives nothing for a runtime it can’t tell', () => {
		assert.equal(detectRuntime({ versions: { node: '24.0.0' }, release: { name: 'io.js' } }), null);
		assert.equal(detectRuntime({ versions: {} }), null);
	});

	it('knows the runtime this test runs on', () => {
		assert.equal(detectRuntime()?.version, process.versions.node);
	});
});

describe('readLicenses', () => {
	it('lists the app, the vendored Tailwind and Font Awesome with their versions, the runtime and the programs it runs', async () => {
		const root = await tree({
			app: {
				LICENSE: 'Unlicense text',
				public: {
					vendor: {
						'tailwindcss-browser-4.3.3.js': '',
						'tailwindcss-browser.LICENSE': 'MIT text',
						'fontawesome': {
							'LICENSE.txt': 'Font Awesome license text',
							'svgs-full': { solid: { 'play.svg': '<svg><!--! Font Awesome Free 7.3.1 by @fontawesome --></svg>' } },
						},
					},
				},
			},
			runtime: { node: '', LICENSE: 'Node license text' },
		});

		const licenses = await readLicenses({
			appVersion: '1.2.3',
			publicDir: join(root, 'app', 'public'),
			runtime: NODE,
			execPath: join(root, 'runtime', 'node'),
		});

		assert.deepEqual(licenses.included.map(({ id, version, text }) => [id, version, text]), [
			['app', '1.2.3', 'Unlicense text'],
			['tailwind', '4.3.3', 'MIT text'],
			['fontawesome', '7.3.1', 'Font Awesome license text'],
			['node', '24.22.2', 'Node license text'],
		]);
		assert.equal(licenses.included[2].url, 'https://fontawesome.com/license/free');
		assert.deepEqual(licenses.external.map(({ id }) => id), ['yt-dlp', 'ffmpeg']);
	});

	it('leaves out the texts it can’t read, and Node’s when no license sits beside the binary', async () => {
		const root = await tree({ public: {}, bin: { node: '' } });

		const { included } = await readLicenses({ appVersion: '1.2.3', publicDir: join(root, 'public'), runtime: NODE, execPath: join(root, 'bin', 'node') });

		assert.deepEqual(included.map(({ id, version, text }) => [id, version, text]), [
			['app', '1.2.3', null],
			['tailwind', null, null],
			['fontawesome', null, null],
			['node', '24.22.2', null],
		]);
		assert.equal(included[3].url, NODE.url);
	});

	it('reads no license file for Bun or Deno', async () => {
		const root = await tree({ public: {}, bin: { bun: '', LICENSE: 'not Bun’s' } });
		const bun = { id: /** @type {const} */ ('bun'), name: 'Bun', version: '1.3.1', license: 'MIT', url: 'https://github.com/oven-sh/bun/blob/main/LICENSE.md' };

		const { included } = await readLicenses({ appVersion: '1.2.3', publicDir: join(root, 'public'), runtime: bun, execPath: join(root, 'bin', 'bun') });

		assert.deepEqual(included[3], { ...bun, text: null });
	});

	it('leaves out a runtime it can’t tell', async () => {
		const root = await tree({ public: {} });

		const { included } = await readLicenses({ appVersion: '1.2.3', publicDir: join(root, 'public'), runtime: null });

		assert.deepEqual(included.map(({ id }) => id), ['app', 'tailwind', 'fontawesome']);
	});
});
