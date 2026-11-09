import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { scanAudioDirectory } from '../../../src/library/scanner.js';
import { copyFixture, createTmpTree } from '../../helpers/tmp-tree.js';

describe('scanAudioDirectory', () => {
	/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
	let tree;
	/** @type {import('../../../src/library/scanner.js').ScanResult} */
	let scan;

	before(async () => {
		tree = await createTmpTree({
			'.soundboard': '{ "version": 1 }',
			'Boom.mp3': '12345',
			'Boom.mp3.json': '{}',
			'Creak.ogg': '123',
			'Café.mp3': '',
			'notes.json': '{}',
			'Song.wav': '',
			'cover.jpg': '',
			'Combat': {
				'10 Finale.mp3': '',
				'2 Battle.mp3': '',
				'2 Battle.mp3.json': '{}',
				'stray.json': '{}',
				'Boss': {
					'Phase 1.ogg': '',
					'Phase 1.ogg.json': '{}',
					'Deeper': { 'x.mp3': '' },
				},
				'.hidden': { 'secret.mp3': '' },
			},
			'Combat.json': '{}',
			'Empty': { 'readme.txt': '' },
			'Tavern': { 'Song.flac': '' },
		});
		await symlink(join(tree.root, 'Boom.mp3'), join(tree.root, 'Link.mp3'));
		await symlink(join(tree.root, 'Combat', 'Boss'), join(tree.root, 'Combat', 'LinkDir'));
		scan = await scanAudioDirectory(tree.root);
	});
	after(() => tree.remove());

	it('detects the settings file', () => {
		assert.equal(scan.hasSettingsFile, true);
		assert.equal(scan.settingsPath, join(tree.root, '.soundboard'));
	});

	it('lists sounds with their size, date, paths and options file', async () => {
		assert.deepEqual(scan.sounds.map((sound) => sound.id), ['Boom.mp3', 'Café.mp3', 'Creak.ogg']);
		assert.deepEqual(scan.sounds[0], {
			id: 'Boom.mp3',
			name: 'Boom.mp3',
			format: 'mp3',
			size: 5,
			modified: (await stat(join(tree.root, 'Boom.mp3'))).mtime.toISOString(),
			absolutePath: join(tree.root, 'Boom.mp3'),
			optionsPath: join(tree.root, 'Boom.mp3.json'),
			hasOptions: true,
			backgroundPaths: [],
		});
		assert.equal(scan.sounds[2].hasOptions, false);
	});

	it('keeps file names exactly as the file system returns them', () => {
		assert.equal(scan.sounds[1].name, 'Café.mp3');
	});

	it('lists playlists with their options file', () => {
		assert.deepEqual(scan.playlists.map((playlist) => [playlist.id, playlist.hasOptions]), [
			['Combat', true],
			['Empty', false],
			['Tavern', false],
		]);
		assert.equal(scan.playlists[0].absolutePath, join(tree.root, 'Combat'));
		assert.equal(scan.playlists[0].optionsPath, join(tree.root, 'Combat.json'));
	});

	it('collects tracks from every depth, sorted by path', () => {
		const combat = scan.playlists[0];
		assert.deepEqual(combat.tracks.map((track) => [track.id, track.hasOptions]), [
			['Combat/2 Battle.mp3', true],
			['Combat/10 Finale.mp3', false],
			['Combat/Boss/Deeper/x.mp3', false],
			['Combat/Boss/Phase 1.ogg', true],
		]);
		assert.equal(combat.tracks[3].absolutePath, join(tree.root, 'Combat', 'Boss', 'Phase 1.ogg'));
		assert.equal(combat.tracks[3].optionsPath, join(tree.root, 'Combat', 'Boss', 'Phase 1.ogg.json'));
	});

	it('lists nested subdirectories at every depth, skipping hidden ones', () => {
		assert.deepEqual(scan.playlists[0].subdirectories, ['Boss', 'Boss/Deeper']);
	});

	it('reports warnings sorted by path', () => {
		assert.deepEqual(scan.warnings, [
			{ kind: 'symlink', path: 'Combat/LinkDir' },
			{ kind: 'orphan-options', path: 'Combat/stray.json' },
			{ kind: 'empty-playlist', path: 'Empty' },
			{ kind: 'symlink', path: 'Link.mp3' },
			{ kind: 'orphan-options', path: 'notes.json' },
			{ kind: 'unsupported-audio', path: 'Song.wav' },
			{ kind: 'empty-playlist', path: 'Tavern' },
			{ kind: 'unsupported-audio', path: 'Tavern/Song.flac' },
		]);
	});

	it('reports a missing settings file', async () => {
		const empty = await createTmpTree({ 'a.mp3': '' });
		try {
			assert.equal((await scanAudioDirectory(empty.root)).hasSettingsFile, false);
		} finally {
			await empty.remove();
		}
	});

	it('fails when the root does not exist', async () => {
		await assert.rejects(scanAudioDirectory(join(tree.root, 'missing')), { code: 'ENOENT' });
	});

	it('scans the example fixture', async () => {
		const copy = await copyFixture('example_soundboard');
		try {
			const fixture = await scanAudioDirectory(copy.root);
			assert.equal(fixture.hasSettingsFile, false);
			assert.deepEqual(fixture.sounds.map((sound) => sound.id), [
				'Sound MP3 no title tag.mp3',
				'Sound MP3 with title tag.mp3',
				'Sound OGG no title tag.ogg',
				'Sound OGG with title tag.ogg',
			]);
			assert.deepEqual(fixture.playlists.map((playlist) => [playlist.id, playlist.tracks.length]), [
				['Music Mix', 2],
				['Music MP3', 2],
				['Music Ogg', 2],
				['Music Order', 6],
			]);
			assert.deepEqual(fixture.warnings, []);
		} finally {
			await copy.remove();
		}
	});
});
