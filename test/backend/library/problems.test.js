import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { Problems, startupProblems } from '../../../src/library/problems.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** @param {string} path @param {string} [kind] */
const problem = (path, kind = 'symlink') => ({ id: `${kind}:${path}`, kind, severity: /** @type {const} */ ('warning'), path, message: 'm' });

describe('startupProblems', () => {
	it('turns scan warnings into warnings and unmeasured files into errors', () => {
		const library = /** @type {any} */ ({
			sounds: [{ id: 'Boom.mp3', duration: null }, { id: 'Ok.mp3', duration: 3 }],
			playlists: [{ tracks: [{ id: 'Combat/1.mp3', duration: null }] }],
		});
		const problems = startupProblems([{ kind: 'unsupported-audio', path: 'Song.wav' }, { kind: 'empty-playlist', path: 'Empty' }], library);
		assert.deepEqual(problems.map(({ id, severity }) => [id, severity]), [
			['unsupported-audio:Song.wav', 'warning'],
			['empty-playlist:Empty', 'warning'],
			['unknown-duration:Boom.mp3', 'error'],
			['unknown-duration:Combat/1.mp3', 'error'],
		]);
	});

	it('is what bootstrap returns for a directory with files that can\'t be used', async () => {
		const tree = await createTmpTree({ '.soundboard': JSON.stringify({ version: 1 }), 'Boom.mp3': 'boom', 'Song.wav': 'wav' });
		trees.push(tree);
		const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
		assert.equal(outcome.status, 'ready');
		assert.deepEqual(outcome.problems.map((entry) => entry.id), ['unsupported-audio:Song.wav', 'unknown-duration:Boom.mp3']);
	});
});

describe('Problems', () => {
	it('dismisses one problem, reporting whether it knew it', () => {
		const problems = new Problems([problem('A.mp3'), problem('B.mp3')]);
		assert.equal(problems.dismiss('symlink:A.mp3'), true);
		assert.equal(problems.dismiss('symlink:A.mp3'), false);
		assert.deepEqual(problems.list.map((entry) => entry.path), ['B.mp3']);
	});

	it('tells listeners about real changes only', () => {
		const problems = new Problems([problem('A.mp3')]);
		/** @type {number[]} */
		const counts = [];
		const unsubscribe = problems.onChange((list) => counts.push(list.length));
		problems.replace([problem('A.mp3')]);
		problems.replace([problem('A.mp3'), problem('B.mp3')]);
		problems.dismissAll();
		problems.dismissAll();
		unsubscribe();
		problems.replace([problem('C.mp3')]);
		assert.deepEqual(counts, [2, 0]);
	});

	it('forgets a file\'s problems, and a directory\'s with everything in it', () => {
		const problems = new Problems([problem('Combat/1.mp3'), problem('Combat'), problem('Combat2/1.mp3'), problem('Boom.mp3')]);
		problems.removeFor('Combat');
		assert.deepEqual(problems.list.map((entry) => entry.path), ['Combat2/1.mp3', 'Boom.mp3']);
		problems.removeFor('Boom.mp3');
		assert.deepEqual(problems.list.map((entry) => entry.path), ['Combat2/1.mp3']);
	});
});
