import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { sha1File } from '../../../src/library/durations.js';
import { scanAudioDirectory } from '../../../src/library/scanner.js';
import { differs, matchesScan, stampFile, takeBaseline, takeSnapshot } from '../../../src/library/tree-snapshot.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** A directory as bootstrap leaves it: every audio file has its options file with a measured duration. */
async function bootstrapped() {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Boom.mp3': 'boom',
		'Boom.mp3.wf': 'a waveform',
		'.DS_Store': 'mac',
		'Old.json': '{}',
		'Rain.wav': 'unsupported',
		'Combat': { '1.mp3': 'one' },
	});
	trees.push(tree);
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
	assert.equal(outcome.status, 'ready');
	return { root: tree.root, scan: outcome.scan };
}

/**
 * @param {string} root
 * @param {Iterable<string>} paths
 */
const relativeTo = (root, paths) => [...paths].map((path) => path.slice(root.length + 1)).toSorted();

/** @param {string} path */
async function touch(path) {
	const later = new Date(Date.now() + 60_000);
	await utimes(path, later, later);
}

describe('takeSnapshot', () => {
	it('lists the audio files, their options files, playlist options files and .soundboard', async () => {
		const { root } = await bootstrapped();
		assert.deepEqual(relativeTo(root, (await takeSnapshot(root)).keys()), [
			'.soundboard',
			'Boom.mp3',
			'Boom.mp3.json',
			'Combat.json',
			join('Combat', '1.mp3'),
			join('Combat', '1.mp3.json'),
		].toSorted());
	});

	it('records each file\'s size and modified time', async () => {
		const { root } = await bootstrapped();
		const stamp = (await takeSnapshot(root)).get(join(root, 'Boom.mp3'));
		const { size, modified } = await stampFile(join(root, 'Boom.mp3'));
		assert.deepEqual(stamp, { size, modified });
	});
});

describe('takeBaseline', () => {
	it('hashes options files and takes the audio hash recorded with the duration', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		assert.equal(baseline.get(join(root, 'Boom.mp3'))?.sha1, await sha1File(join(root, 'Boom.mp3')));
		assert.equal(baseline.get(join(root, 'Boom.mp3.json'))?.sha1, await sha1File(join(root, 'Boom.mp3.json')));
		assert.equal(baseline.get(join(root, '.soundboard'))?.sha1, await sha1File(join(root, '.soundboard')));
	});

	it('leaves the audio hash unknown when the recorded one is for another version of the file', async () => {
		const { root } = await bootstrapped();
		await writeFile(join(root, 'Boom.mp3'), 'a louder boom');
		assert.equal((await takeBaseline(root)).get(join(root, 'Boom.mp3'))?.sha1, null);
	});
});

describe('differs', () => {
	it('finds nothing in an unchanged directory, with or without hashing', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: false }), false);
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: true }), false);
	});

	it('ignores files the app does not read, such as waveforms and orphans', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		await writeFile(join(root, 'Boom.mp3.wf'), 'a new waveform');
		await writeFile(join(root, 'Another.json'), '{}');
		await writeFile(join(root, 'Song.flac'), 'unsupported');
		await writeFile(join(root, 'Boom.mp3.json.tmp'), '{}');
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: false }), false);
	});

	it('counts a new audio file', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		await writeFile(join(root, 'Combat', '2.ogg'), 'two');
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: true }), true);
	});

	it('counts a deleted file', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		await rm(join(root, 'Combat', '1.mp3'));
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: true }), true);
	});

	it('counts a changed options file', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		await writeFile(join(root, 'Combat.json'), JSON.stringify({ title: 'Battle' }));
		await touch(join(root, 'Combat.json'));
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: true }), true);
	});

	it('counts a replaced audio file', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		await writeFile(join(root, 'Boom.mp3'), 'bang');
		await touch(join(root, 'Boom.mp3'));
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: true }), true);
	});

	it('ignores a touched file when hashing, and remembers its new date', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		await touch(join(root, 'Boom.mp3'));
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: true }), false);
		assert.deepEqual(baseline.get(join(root, 'Boom.mp3')), await stampFile(join(root, 'Boom.mp3')));
	});

	it('counts a touched file without hashing', async () => {
		const { root } = await bootstrapped();
		const baseline = await takeBaseline(root);
		await touch(join(root, 'Boom.mp3'));
		assert.equal(await differs(baseline, await takeSnapshot(root), { hash: false }), true);
	});
});

describe('matchesScan', () => {
	it('holds for the scan the baseline was taken after', async () => {
		const { root, scan } = await bootstrapped();
		assert.equal(matchesScan(await takeBaseline(root), scan), true);
	});

	it('fails when an audio file was added, removed or changed after the scan', async () => {
		const { root } = await bootstrapped();
		const scan = await scanAudioDirectory(root);
		await writeFile(join(root, 'New.mp3'), 'new');
		assert.equal(matchesScan(await takeBaseline(root), scan), false);
		await rm(join(root, 'New.mp3'));
		await rm(join(root, 'Boom.mp3'));
		assert.equal(matchesScan(await takeBaseline(root), scan), false);
	});
});
