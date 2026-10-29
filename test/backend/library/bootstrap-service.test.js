import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
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
/** What a file whose name and tags say nothing about its origin is given (DESIGN.md §3.3). */
const UNKNOWN = { origin: 'unknown' };

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

/**
 * An audio options file without the measured duration, which the tests under "durations" check on their own.
 * @param {string} root
 * @param {string} relativePath
 */
async function readOptions(root, relativePath) {
	const options = await readJson(root, relativePath);
	delete options.duration;
	delete options.measuredFrom;
	return options;
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
			assert.deepEqual(await readOptions(root, 'Boom.mp3.json'), { title: 'Boom.mp3', source: UNKNOWN });
			assert.deepEqual(await readOptions(root, 'Combat/1.ogg.json'), { title: '1.ogg', source: UNKNOWN });
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
			assert.deepEqual(await readOptions(root, 'Boom.mp3.json'), { title: 'Tagged Title', source: UNKNOWN });
			assert.deepEqual(await readOptions(root, 'Plain.mp3.json'), { title: 'Plain.mp3', source: UNKNOWN });
			assert.deepEqual(await readOptions(root, 'Combat/1.ogg.json'), { title: 'Ogg Title', source: UNKNOWN });
		});

		it('uses file names when metadata titles are declined', async () => {
			const root = await tree({ 'Boom.mp3': TITLED_MP3 });
			await bootstrap(root, [false]);
			assert.deepEqual(await readOptions(root, 'Boom.mp3.json'), { title: 'Boom.mp3', source: UNKNOWN });
		});

		it('only reads metadata for files without options and keeps existing options files', async () => {
			const root = await tree({ 'Boom.mp3': TITLED_MP3, 'Boom.mp3.json': '{ "title": "Mine", "extra": 1 }' });
			const { prompter } = await bootstrap(root);
			assert.deepEqual(prompter.questions, []);
			assert.deepEqual(await readOptions(root, 'Boom.mp3.json'), { title: 'Mine', extra: 1, source: UNKNOWN });
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
				['Music Order', ['Order 1', 'Order 2', 'Order 3', 'Order 4', 'Order 5', 'Order 6']],
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
			assert.deepEqual(await readOptions(root, 'New.mp3.json'), { title: 'Tagged Title', source: UNKNOWN });
			assert.deepEqual(await readOptions(root, 'Plain.ogg.json'), { title: 'Plain.ogg', source: UNKNOWN });
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
			const { prompter } = await bootstrap(root);
			assert.deepEqual(prompter.questions, []);
			assert.deepEqual(await readJson(root, 'Combat.json'), { includedSubdirectories: ['Boss'] });
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
				'Loud.mp3': '',
				'Loud.mp3.json': '{ "gain": 5 }',
				'Combat.json': '{ "includedSubdirectories": "Boss" }',
				'Combat': { '1.mp3': '', '1.mp3.json': '[]', 'Boss': { '2.mp3': '' } },
				'Calm.json': '{ "gain": -1 }',
				'Calm': { '1.mp3': '' },
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
				join(root, 'Loud.mp3.json'),
				join(root, 'Combat', '1.mp3.json'),
				join(root, 'Combat.json'),
				join(root, 'Calm.json'),
			].toSorted());
			assert.deepEqual(await listFiles(root), before);
		});

		it('passes file system errors through', async () => {
			await assert.rejects(bootstrap(join(await tree({}), 'missing')), { code: 'ENOENT' });
		});
	});

	describe('durations', () => {
		async function fixture() {
			const copy = await copyFixture('example_soundboard');
			trees.push(copy);
			return copy.root;
		}
		const SOUND = 'Sound OGG no title tag.ogg';

		it('measures every sound and track on the first run and stores it with what it was measured from', async () => {
			const root = await fixture();
			const { outcome, reporter } = await bootstrap(root, [true]);
			const options = await readJson(root, `${SOUND}.json`);
			const { size, mtime } = await stat(join(root, SOUND));
			assert.ok(Math.abs(options.duration - 4.95) < 0.1, String(options.duration));
			assert.deepEqual({ ...options.measuredFrom, sha1: options.measuredFrom.sha1.length }, { size, modified: mtime.toISOString(), sha1: 40 });
			assert.equal(readyLibrary(outcome).sounds.find((sound) => sound.id === SOUND)?.duration, options.duration);
			assert.ok(readyLibrary(outcome).playlists.every((playlist) => playlist.tracks.every((track) => (track.duration ?? 0) > 9.9)));
			assert.deepEqual(reporter.callsTo('measuringDurations'), [16]);
		});

		it('reads nothing again on a later run when nothing changed', async () => {
			const root = await fixture();
			await bootstrap(root, [true]);
			const { reporter } = await bootstrap(root);
			assert.deepEqual(reporter.callsTo('measuringDurations'), []);
			assert.deepEqual(reporter.callsTo('optionsGenerated'), []);
		});

		it('only refreshes the record of a file that was touched but not changed', async () => {
			const root = await fixture();
			await bootstrap(root, [true]);
			const before = await readJson(root, `${SOUND}.json`);
			const touched = new Date('2030-01-01T00:00:00Z');
			await utimes(join(root, SOUND), touched, touched);
			const { reporter } = await bootstrap(root);
			const after = await readJson(root, `${SOUND}.json`);
			assert.deepEqual(reporter.callsTo('measuringDurations'), [1]);
			assert.equal(after.duration, before.duration);
			assert.deepEqual(after.measuredFrom, { ...before.measuredFrom, modified: touched.toISOString() });
		});

		it('measures a file again when it was replaced under the same name', async () => {
			const root = await fixture();
			await bootstrap(root, [true]);
			await copyFile(join(root, 'Music Ogg', 'Song 1 OGG with title tag.ogg'), join(root, SOUND));
			await bootstrap(root);
			const after = await readJson(root, `${SOUND}.json`);
			assert.ok(Math.abs(after.duration - 30.25) < 0.1, String(after.duration));
			assert.equal(after.title, 'Sound OGG no title tag.ogg', 'the title is kept');
		});

		it('stores null for a file whose duration cannot be read, and does not try again', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'Broken.mp3': 'not audio' });
			await bootstrap(root);
			assert.equal((await readJson(root, 'Broken.mp3.json')).duration, null);
			const { reporter } = await bootstrap(root);
			assert.deepEqual(reporter.callsTo('measuringDurations'), []);
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

	describe('refresh', () => {
		/** @param {string} root */
		async function refresh(root) {
			const prompter = new FakePrompter();
			const reporter = new FakeReporter();
			const outcome = await new BootstrapService({ prompter, reporter }).refresh(root);
			return { outcome, prompter, reporter };
		}

		it('builds the library again, with options files for new audio files', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'a.mp3': '' });
			await bootstrap(root);
			await writeFile(join(root, 'b.mp3'), TITLED_MP3);
			const { outcome } = await refresh(root);
			assert.equal(outcome.status, 'ready');
			assert.deepEqual(outcome.library.sounds.map((sound) => sound.title), ['a.mp3', 'Tagged Title']);
			assert.equal(outcome.scan.root, root);
			assert.deepEqual(await readOptions(root, 'b.mp3.json'), { title: 'Tagged Title', source: UNKNOWN });
		});

		it('merges new nested directories without asking and without recording them', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'Combat': { '1.mp3': '' } });
			await bootstrap(root);
			await mkdir(join(root, 'Combat', 'Boss'));
			await writeFile(join(root, 'Combat', 'Boss', '2.mp3'), '');
			await mkdir(join(root, 'Tavern', 'Back room'), { recursive: true });
			await writeFile(join(root, 'Tavern', 'Back room', '1.mp3'), '');
			const { outcome, prompter, reporter } = await refresh(root);
			assert.equal(outcome.status, 'ready');
			assert.deepEqual(prompter.questions, []);
			assert.deepEqual(reporter.callsTo('nestedDirectories'), []);
			assert.deepEqual(outcome.library.playlists.map((playlist) => playlist.tracks.map((track) => track.id)), [
				['Combat/1.mp3', 'Combat/Boss/2.mp3'],
				['Tavern/Back room/1.mp3'],
			]);
			assert.deepEqual((await readJson(root, 'Combat.json')).includedSubdirectories, []);
			assert.deepEqual((await readJson(root, 'Tavern.json')).includedSubdirectories, []);
		});

		it('leaves the nested directories for the next start to ask about', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'Combat': { '1.mp3': '' } });
			await bootstrap(root);
			await mkdir(join(root, 'Combat', 'Boss'));
			await writeFile(join(root, 'Combat', 'Boss', '2.mp3'), '');
			await refresh(root);
			const { prompter } = await bootstrap(root, [true]);
			assert.deepEqual(prompter.questions, [NESTED_DIRECTORIES_QUESTION]);
			assert.deepEqual((await readJson(root, 'Combat.json')).includedSubdirectories, ['Boss']);
		});

		it('returns the validation errors and writes nothing', async () => {
			const root = await tree({ '.soundboard': SETTINGS, 'a.mp3': '' });
			await bootstrap(root);
			await writeFile(join(root, 'a.mp3.json'), '{ "gain": 99 }');
			await writeFile(join(root, 'b.mp3'), '');
			const { outcome, reporter } = await refresh(root);
			assert.equal(outcome.status, 'invalid');
			assert.ok(outcome.status === 'invalid' && outcome.errors[0] instanceof ValidationError);
			assert.equal(reporter.callsTo('validationErrors').length, 1);
			assert.equal(await exists(join(root, 'b.mp3.json')), false);
		});

		it('stops without .soundboard, since that would be a first run with questions', async () => {
			const root = await tree({ 'a.mp3': '' });
			const { outcome } = await refresh(root);
			assert.equal(outcome.status, 'noSettings');
			assert.deepEqual(await listFiles(root), ['a.mp3']);
		});
	});
});
