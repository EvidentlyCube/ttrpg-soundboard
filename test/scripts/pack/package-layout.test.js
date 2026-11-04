import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packageEntries, packageName } from '../../../scripts/pack/package-layout.js';
import { PLATFORMS } from '../../../scripts/pack/platforms.js';
import { EXECUTABLE_MODE } from '../../../scripts/pack/zip.js';

const platform = (/** @type {string} */ name) => /** @type {import('../../../scripts/pack/platforms.js').Platform} */ (
	PLATFORMS.find((candidate) => candidate.name === name)
);

/** @type {Record<string, string>} */
const TEMPLATES = {
	'start.sh': '#!/bin/sh\nrun\n',
	'start.cmd': '@echo off\nrun\n',
	'README-windows.txt': 'Windows {{VERSION}} with Node {{NODE_VERSION}}\nend\n',
	'README-macos.txt': 'macOS {{VERSION}}\n',
	'README-linux.txt': 'Linux {{VERSION}}, again {{VERSION}}\n',
};

/** @param {string} name */
function entries(name) {
	return packageEntries({
		platform: platform(name),
		version: '1.2.3',
		nodeVersion: '24.0.0',
		appFiles: [{ path: 'src/a.js', data: Buffer.from('code') }],
		runtime: { binary: Buffer.from('node'), license: Buffer.from('license') },
		template: (template) => TEMPLATES[template],
	});
}

/** @param {ReturnType<typeof entries>} list */
function summary(list) {
	return list.map(({ path, data, mode }) => [path, data.toString('utf8'), mode === EXECUTABLE_MODE ? 'x' : '-']);
}

describe('packageName', () => {
	it('names the zip after the version and the platform', () => {
		assert.equal(packageName('1.2.3', platform('macos-x64')), 'ttrpg-soundboard-1.2.3-macos-x64');
	});
});

describe('packageEntries', () => {
	it('puts the launcher, the README, the app and the runtime under one folder', () => {
		assert.deepEqual(summary(entries('linux-x64')), [
			['ttrpg-soundboard-1.2.3-linux-x64/start-soundboard.sh', '#!/bin/sh\nrun\n', 'x'],
			['ttrpg-soundboard-1.2.3-linux-x64/README.txt', 'Linux 1.2.3, again 1.2.3\n', '-'],
			['ttrpg-soundboard-1.2.3-linux-x64/app/src/a.js', 'code', '-'],
			['ttrpg-soundboard-1.2.3-linux-x64/runtime/node', 'node', 'x'],
			['ttrpg-soundboard-1.2.3-linux-x64/runtime/LICENSE', 'license', '-'],
		]);
	});

	it('gives macOS a launcher that opens in Terminal', () => {
		assert.deepEqual(summary(entries('macos-arm64')).slice(0, 2), [
			['ttrpg-soundboard-1.2.3-macos-arm64/Start Soundboard.command', '#!/bin/sh\nrun\n', 'x'],
			['ttrpg-soundboard-1.2.3-macos-arm64/README.txt', 'macOS 1.2.3\n', '-'],
		]);
	});

	it('gives Windows a batch file and node.exe, with Windows line endings in the text files only', () => {
		assert.deepEqual(summary(entries('windows-x64')), [
			['ttrpg-soundboard-1.2.3-windows-x64/Start Soundboard.cmd', '@echo off\r\nrun\r\n', 'x'],
			['ttrpg-soundboard-1.2.3-windows-x64/README.txt', 'Windows 1.2.3 with Node 24.0.0\r\nend\r\n', '-'],
			['ttrpg-soundboard-1.2.3-windows-x64/app/src/a.js', 'code', '-'],
			['ttrpg-soundboard-1.2.3-windows-x64/runtime/node.exe', 'node', 'x'],
			['ttrpg-soundboard-1.2.3-windows-x64/runtime/LICENSE', 'license', '-'],
		]);
	});
});
