import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	BootstrapService,
	METADATA_TITLES_QUESTION,
	NESTED_DIRECTORIES_QUESTION,
} from '../../../src/library/bootstrap-service.js';
import { ValidationError } from '../../../src/library/errors.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { buildId3v2, buildOgg, textFrame } from '../../helpers/tag-builders.js';
import { copyFixture, createTmpTree } from '../../helpers/tmp-tree.js';

const TITLED_MP3 = buildId3v2({ frames: [textFrame('TIT2', 'Tagged Title')] });
const TITLED_OGG = buildOgg({ comments: ['TITLE=Ogg Title'] });
const SETTINGS = JSON.stringify({ version: 1 });

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** @param {import('../../helpers/tmp-tree.js').TreeSpec} spec */
async function tree(spec) {
	const created = await createTmpTree(spec);
	trees.push(created);
	return created.root;
}

/**
 * @param {string} root
 * @param {boolean[]} [answers]
 */
async function bootstrap(root, answers = []) {
	const prompter = new FakePrompter(answers);
	const reporter = new FakeReporter();
	const outcome = await new BootstrapService({ prompter, reporter }).run(root);
	return { outcome, prompter, reporter };
}

/**
 * @param {string} root
 * @param {string} relativePath
 */
async function readJson(root, relativePath) {
	return JSON.parse(await readFile(join(root, ...relativePath.split('/')), 'utf8'));
}

/** @param {string} root */
async function listFiles(root) {
	return (await readdir(root, { recursive: true })).toSorted();
}

/** @param {string} path */
async function exists(path) {
	return stat(path).then(() => true, () => false);
}

/** @param {import('../../../src/library/bootstrap-service.js').BootstrapOutcome} outcome */
function readyLibrary(outcome) {
	assert.equal(outcome.status, 'ready');
	return outcome.library;
}

describe('BootstrapService', () => {
	describe('first run', () => {
		it('creates options files named after the files and the settings file, without asking', async () => {
			const root = await tree({ 'Boom.mp3': '', 'Combat': { '1.ogg': '' } });
			const { outcome, prompter } = await bootstrap(root);

			assert.deepEqual(prompter.questions, []);
			assert.deepEqual(await readJson(root, 'Boom.mp3.json'), { title: 'Boom.mp3' });
			assert.deepEqual(await readJson(root, 'Combat/1.ogg.json'), { title: '1.ogg' });
			assert.deepEqual(await readJson(root, 'Combat.json'), { title: 'Combat', includedSubdirectories: [] });
			assert.deepEqual(await readJson(root, '.soundboard'), { version: 1, volumes: { master: 1, music: 1, sfx: 1 } });
			assert.equal(outcome.status, 'ready');
		});

		it('returns the library and the settings', async () => {
			const root = await tree({ 'Boom.mp3': '', 'Combat': { '1.ogg': '' } });
			const { outcome, reporter } = await bootstrap(root);

			assert.equal(outcome.status, 'ready');
			assert.deepEqual(outcome.library.sounds.map((sound) => sound.title), ['Boom.mp3']);
			assert.deepEqual(outcome.library.playlists.map((playlist) => playlist.id), ['Combat']);
			assert.deepEqual(outcome.settings.settings, { volumes: { master: 1, music: 1, sfx: 1 } });
			assert.deepEqual(reporter.callsTo('optionsGenerated'), [3]);
			assert.deepEqual(reporter.callsTo('libraryLoaded'), [outcome.library]);
		});

		it('offers metadata titles and uses them when accepted', async () => {
			const root = await tree({ 'Boom.mp3': TITLED_MP3, 'Plain.mp3': '', 'Combat': { '1.ogg': TITLED_OGG } });
			const { prompter, reporter } = await bootstrap(root, [true]);

			assert.deepEqual(prompter.questions, [METADATA_TITLES_QUESTION]);
			assert.deepEqual(reporter.callsTo('metadataTitles'), [[
				{ path: 'Boom.mp3', title: 'Tagged Title' },
				{ path: 'Combat/1.ogg', title: 'Ogg Title' },
			]]);
			assert.deepEqual(await readJson(root, 'Boom.mp3.json'), { title: 'Tagged Title' });
			assert.deepEqual(await readJson(root, 'Plain.mp3.json'), { title: 'Plain.mp3' });
			assert.deepEqual(await readJson(root, 'Combat/1.ogg.json'), { title: 'Ogg Title' });
		});

		it('uses file names when metadata titles are declined', async () => {
			const root = await tree({ 'Boom.mp3': TITLED_MP3 });
			await bootstrap(root, [false]);
			assert.deepEqual(await readJson(root, 'Boom.mp3.json'), { title: 'Boom.mp3' });
		});

		it('only reads metadata for files without options and keeps existing options files', async () => {
			const root = await tree({ 'Boom.mp3': TITLED_MP3, 'Boom.mp3.json': '{ "title": "Mine", "extra": 1 }' });
			const { prompter } = await bootstrap(root);
			assert.deepEqual(prompter.questions, []);
			assert.deepEqual(await readJson(root, 'Boom.mp3.json'), { title: 'Mine', extra: 1 });
		});

		it('asks about nested directories and records them when accepted', async () => {
			const root = await tree({ Combat: { '1.mp3': '', 'Boss': { '2.mp3': '', 'Phase 2': { '3.mp3': '' } } } });
			const { outcome, prompter, reporter } = await bootstrap(root, [true]);

			assert.deepEqual(prompter.questions, [NESTED_DIRECTORIES_QUESTION]);
			assert.deepEqual(reporter.callsTo('nestedDirectories'), [['Combat/Boss', 'Combat/Boss/Phase 2']]);
			assert.deepEqual(await readJson(root, 'Combat.json'), { title: 'Combat', includedSubdirectories: ['Boss', 'Boss/Phase 2'] });
			assert.deepEqual(readyLibrary(outcome).playlists[0].tracks.map((track) => track.id), [
				'Combat/1.mp3',
				'Combat/Boss/2.mp3',
				'Combat/Boss/Phase 2/3.mp3',
			]);
		});

		it('writes nothing when nested directories are declined', async () => {
			const root = await tree({ 'Boom.mp3': TITLED_MP3, 'Combat': { Boss: { '2.mp3': '' } } });
			const before = await listFiles(root);
			const { outcome, prompter } = await bootstrap(root, [false]);

			assert.equal(outcome.status, 'cancelled');
			assert.deepEqual(prompter.questions, [NESTED_DIRECTORIES_QUESTION]);
			assert.deepEqual(await listFiles(root), before);
		});

		it('writes the settings file last, so a failed write means the next run is a first run again', async () => {
			const root = await tree({ 'a.mp3': '', 'b.mp3': '' });
			await mkdir(join(root, 'b.mp3.json.tmp'));
			await assert.rejects(bootstrap(root));
			assert.equal(await exists(join(root, '.soundboard')), false);
		});

		it('scans the example fixture end to end', async () => {
			const copy = await copyFixture('example_soundboard');
			trees.push(copy);
			const { outcome } = await bootstrap(copy.root, [true]);
			const library = readyLibrary(outcome);

			assert.deepEqual(library.sounds.map((sound) => sound.title), [
				'Base Connected',
				'Cluster Unlock',
				'Sound MP3 no title tag.mp3',
				'Sound OGG no title tag.ogg',
			]);
			assert.deepEqual(library.playlists.map((playlist) => [playlist.title, playlist.tracks.map((track) => track.title)]), [
				['Music Mix', ['Piece by Piece', 'Intro']],
				['Music MP3', ['Piece by Piece', 'Intro']],
				['Music Ogg', ['Piece by Piece', 'Intro']],
			]);

			const second = await bootstrap(copy.root);
			assert.deepEqual(second.prompter.questions, []);
			assert.deepEqual(second.reporter.callsTo('optionsGenerated'), []);
		});
	});

	describe('later runs', () => {
		it('generates missing options from metadata without asking', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'New.mp3': TITLED_MP3, 'Plain.ogg': '' });
			const { prompter, reporter } = await bootstrap(root);

			assert.deepEqual(prompter.questions, []);
			assert.deepEqual(reporter.callsTo('metadataTitles'), []);
			assert.deepEqual(await readJson(root, 'New.mp3.json'), { title: 'Tagged Title' });
			assert.deepEqual(await readJson(root, 'Plain.ogg.json'), { title: 'Plain.ogg' });
		});

		it('does not rewrite the settings file', async () => {
			const root = await tree({ '.soundboard': JSON.stringify({ version: 1, volumes: { music: 0.3 } }), 'a.mp3': '' });
			const { outcome } = await bootstrap(root);
			assert.deepEqual(await readJson(root, '.soundboard'), { version: 1, volumes: { music: 0.3 } });
			assert.equal(outcome.status === 'ready' && outcome.settings.settings.volumes.music, 0.3);
		});

		it('only asks about subdirectories that were not accepted before', async () => {
			const root = await tree({
				'.soundboard': SETTINGS,
				'Combat.json': JSON.stringify({ title: 'Fight', includedSubdirectories: ['Boss'], futureKey: true }),
				'Combat': { Boss: { '1.mp3': '', '1.mp3.json': '{}' }, New: { '2.mp3': '', '2.mp3.json': '{}' } },
			});
			const { prompter, reporter } = await bootstrap(root, [true]);

			assert.deepEqual(prompter.questions, [NESTED_DIRECTORIES_QUESTION]);
			assert.deepEqual(reporter.callsTo('nestedDirectories'), [['Combat/New']]);
			assert.deepEqual(await readJson(root, 'Combat.json'), {
				title: 'Fight',
				includedSubdirectories: ['Boss', 'New'],
				futureKey: true,
			});
		});

		it('asks nothing when every subdirectory was accepted before', async () => {
			const root = await tree({
				'.soundboard': SETTINGS,
				'Combat.json': JSON.stringify({ includedSubdirectories: ['Boss'] }),
				'Combat': { Boss: { '1.mp3': '', '1.mp3.json': '{}' } },
			});
			const { prompter, reporter } = await bootstrap(root);
			assert.deepEqual(prompter.questions, []);
			assert.deepEqual(reporter.callsTo('optionsGenerated'), []);
		});

		it('treats every subdirectory of a new playlist as new', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'Tavern': { Night: { '1.mp3': '' } } });
			const { reporter } = await bootstrap(root, [true]);
			assert.deepEqual(reporter.callsTo('nestedDirectories'), [['Tavern/Night']]);
			assert.deepEqual(await readJson(root, 'Tavern.json'), { title: 'Tavern', includedSubdirectories: ['Night'] });
		});

		it('writes nothing when new subdirectories are declined', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'New.mp3': '', 'Tavern': { Night: { '1.mp3': '' } } });
			const before = await listFiles(root);
			const { outcome } = await bootstrap(root, [false]);
			assert.equal(outcome.status, 'cancelled');
			assert.deepEqual(await listFiles(root), before);
		});
	});

	describe('validation', () => {
		it('reports every invalid file at once and stops before asking or writing anything', async () => {
			const root = await tree({
				'.soundboard': '{ "version": 99 }',
				'Boom.mp3': TITLED_MP3,
				'Boom.mp3.json': '{ broken',
				'Combat.json': '{ "includedSubdirectories": "Boss" }',
				'Combat': { '1.mp3': '', '1.mp3.json': '[]', 'Boss': { '2.mp3': '' } },
			});
			const before = await listFiles(root);
			const { outcome, prompter, reporter } = await bootstrap(root);

			assert.equal(outcome.status, 'invalid');
			assert.deepEqual(prompter.questions, []);
			const [errors] = /** @type {ValidationError[][]} */ (reporter.callsTo('validationErrors'));
			assert.ok(errors.every((error) => error instanceof ValidationError));
			assert.deepEqual(errors.map((error) => error.filePath).toSorted(), [
				join(root, '.soundboard'),
				join(root, 'Boom.mp3.json'),
				join(root, 'Combat', '1.mp3.json'),
				join(root, 'Combat.json'),
			].toSorted());
			assert.deepEqual(await listFiles(root), before);
		});

		it('passes file system errors through', async () => {
			await assert.rejects(bootstrap(join(await tree({}), 'missing')), { code: 'ENOENT' });
		});
	});

	describe('warnings and empty playlists', () => {
		it('reports scan warnings', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'Song.wav': '', 'a.mp3': '' });
			const { reporter } = await bootstrap(root);
			assert.deepEqual(reporter.callsTo('warnings'), [[{ kind: 'unsupported-audio', path: 'Song.wav' }]]);
		});

		it('does not report when there are no warnings', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'a.mp3': '' });
			const { reporter } = await bootstrap(root);
			assert.deepEqual(reporter.callsTo('warnings'), []);
		});

		it('neither asks about nor writes options for playlists without tracks', async () => {
			const root = await tree({ Artwork: { Covers: { 'front.jpg': '' } } });
			const { prompter } = await bootstrap(root);
			assert.deepEqual(prompter.questions, []);
			assert.equal(await exists(join(root, 'Artwork.json')), false);
		});

		it('still validates the options file of an empty playlist', async () => {
			const root = await tree({ 'Artwork': {}, 'Artwork.json': 'nope' });
			await writeFile(join(root, 'a.mp3'), '');
			const { outcome } = await bootstrap(root);
			assert.equal(outcome.status, 'invalid');
		});
	});
});
