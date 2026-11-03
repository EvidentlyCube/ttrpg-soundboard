import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PackError } from '../../../scripts/pack/errors.js';
import { NodeRuntimes } from '../../../scripts/pack/node-runtime.js';
import { PLATFORMS } from '../../../scripts/pack/platforms.js';
import { tarGz } from '../../helpers/tar-builder.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

const VERSION = '24.0.0';
const BASE = `https://nodejs.org/dist/v${VERSION}`;
const platform = (/** @type {string} */ name) => /** @type {import('../../../scripts/pack/platforms.js').Platform} */ (
	PLATFORMS.find((candidate) => candidate.name === name)
);

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

async function cacheFolder() {
	const created = await createTmpTree({});
	trees.push(created);
	return created.root;
}

/** @param {string} node */
function tarball(node) {
	const top = `node-v${VERSION}-${node}`;
	return tarGz([
		{ path: `${top}/bin/node`, data: `node for ${node}`, mode: 0o755 },
		{ path: `${top}/LICENSE`, data: 'Node license' },
	]);
}

/**
 * A nodejs.org that serves a release and counts what was downloaded.
 * @param {Record<string, Buffer>} [tampered] files served instead of the ones the checksums are for
 */
function fakeNodejsOrg(tampered = {}) {
	/** @type {Record<string, Buffer>} */
	const files = {
		'node-v24.0.0-linux-x64.tar.gz': tarball('linux-x64'),
		'node-v24.0.0-darwin-arm64.tar.gz': tarball('darwin-arm64'),
		'win-x64/node.exe': Buffer.from('node.exe'),
	};
	const sums = Object.entries(files)
		.map(([name, data]) => `${createHash('sha256').update(data).digest('hex')}  ${name}`)
		.join('\n');
	/** @type {string[]} */
	const downloads = [];
	/** @type {import('../../../scripts/pack/node-runtime.js').Download} */
	const download = async (url) => {
		downloads.push(url);
		const name = url.slice(BASE.length + 1);
		if (name === 'SHASUMS256.txt') {
			return Buffer.from(`${sums}\n`);
		}
		const data = tampered[name] ?? files[name];
		if (!data) {
			throw new PackError(`404 ${url}`);
		}
		return data;
	};
	return { download, downloads };
}

describe('NodeRuntimes', () => {
	it('takes the binary and the license out of the platform’s tarball', async () => {
		const { download } = fakeNodejsOrg();
		const runtimes = new NodeRuntimes({ version: VERSION, cacheFolder: await cacheFolder(), download });

		const { binary, license } = await runtimes.runtimeFor(platform('macos-arm64'));

		assert.equal(binary.toString('utf8'), 'node for darwin-arm64');
		assert.equal(license.toString('utf8'), 'Node license');
	});

	it('takes node.exe on its own for Windows, with the license from the Linux tarball', async () => {
		const { download, downloads } = fakeNodejsOrg();
		const runtimes = new NodeRuntimes({ version: VERSION, cacheFolder: await cacheFolder(), download });

		const { binary, license } = await runtimes.runtimeFor(platform('windows-x64'));

		assert.equal(binary.toString('utf8'), 'node.exe');
		assert.equal(license.toString('utf8'), 'Node license');
		assert.deepEqual(downloads, [`${BASE}/SHASUMS256.txt`, `${BASE}/win-x64/node.exe`, `${BASE}/node-v24.0.0-linux-x64.tar.gz`]);
	});

	it('downloads nothing when the cache already has the files', async () => {
		const folder = await cacheFolder();
		await new NodeRuntimes({ version: VERSION, cacheFolder: folder, download: fakeNodejsOrg().download })
			.runtimeFor(platform('linux-x64'));
		const { download, downloads } = fakeNodejsOrg();

		const { binary } = await new NodeRuntimes({ version: VERSION, cacheFolder: folder, download }).runtimeFor(platform('linux-x64'));

		assert.equal(binary.toString('utf8'), 'node for linux-x64');
		assert.deepEqual(downloads, []);
		assert.deepEqual((await readdir(join(folder, `node-v${VERSION}`))).sort(), ['SHASUMS256.txt', 'node-v24.0.0-linux-x64.tar.gz']);
	});

	it('downloads a cached file again when it no longer matches its checksum', async () => {
		const folder = await cacheFolder();
		await new NodeRuntimes({ version: VERSION, cacheFolder: folder, download: fakeNodejsOrg().download })
			.runtimeFor(platform('linux-x64'));
		await writeFile(join(folder, `node-v${VERSION}`, 'node-v24.0.0-linux-x64.tar.gz'), 'truncated');
		const { download, downloads } = fakeNodejsOrg();

		const { binary } = await new NodeRuntimes({ version: VERSION, cacheFolder: folder, download }).runtimeFor(platform('linux-x64'));

		assert.equal(binary.toString('utf8'), 'node for linux-x64');
		assert.deepEqual(downloads, [`${BASE}/node-v24.0.0-linux-x64.tar.gz`]);
	});

	it('refuses a download that does not match its checksum, and caches nothing', async () => {
		const folder = await cacheFolder();
		const { download } = fakeNodejsOrg({ 'win-x64/node.exe': Buffer.from('tampered') });
		const runtimes = new NodeRuntimes({ version: VERSION, cacheFolder: folder, download });

		await assert.rejects(runtimes.runtimeFor(platform('windows-x64')), (error) => {
			assert.ok(error instanceof PackError);
			assert.match(error.message, /win-x64\/node\.exe does not match its checksum/);
			return true;
		});
		assert.deepEqual(await readdir(join(folder, `node-v${VERSION}`)), ['SHASUMS256.txt']);
	});

	it('says when the release has no file for the platform', async () => {
		const { download } = fakeNodejsOrg();
		const runtimes = new NodeRuntimes({ version: VERSION, cacheFolder: await cacheFolder(), download });

		await assert.rejects(runtimes.runtimeFor(platform('macos-x64')), /Node v24\.0\.0 has no node-v24\.0\.0-darwin-x64\.tar\.gz/);
	});
});
