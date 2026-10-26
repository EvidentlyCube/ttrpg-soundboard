import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrary } from '../../../src/library/library.js';

/**
 * @param {string} id
 * @param {boolean} [hasOptions]
 * @returns {import('../../../src/library/scanner.js').ScannedAudio}
 */
function audio(id, hasOptions = false) {
	const name = id.split('/').at(-1) ?? id;
	return {
		id,
		name,
		format: id.endsWith('.ogg') ? 'ogg' : 'mp3',
		size: 100,
		absolutePath: `/music/${id}`,
		optionsPath: `/music/${id}.json`,
		hasOptions,
	};
}

/**
 * @param {string} id
 * @param {import('../../../src/library/scanner.js').ScannedAudio[]} tracks
 * @param {boolean} [hasOptions]
 * @returns {import('../../../src/library/scanner.js').ScannedPlaylist}
 */
function playlist(id, tracks, hasOptions = false) {
	return {
		id,
		absolutePath: `/music/${id}`,
		optionsPath: `/music/${id}.json`,
		hasOptions,
		tracks,
		subdirectories: [],
	};
}

/**
 * @param {Partial<import('../../../src/library/scanner.js').ScanResult>} parts
 * @returns {import('../../../src/library/scanner.js').ScanResult}
 */
function scanOf(parts) {
	return {
		root: '/music',
		hasSettingsFile: true,
		settingsPath: '/music/.soundboard',
		sounds: [],
		playlists: [],
		warnings: [],
		...parts,
	};
}

describe('buildLibrary', () => {
	it('takes titles from options, falling back to the file name', () => {
		const scan = scanOf({ sounds: [audio('Boom.mp3', true), audio('Creak.ogg')] });
		const library = buildLibrary(scan, new Map([['/music/Boom.mp3.json', { title: 'Big Boom' }]]));
		assert.deepEqual(library.sounds, [
			{ id: 'Boom.mp3', title: 'Big Boom', format: 'mp3', size: 100, gain: 1, absolutePath: '/music/Boom.mp3' },
			{ id: 'Creak.ogg', title: 'Creak.ogg', format: 'ogg', size: 100, gain: 1, absolutePath: '/music/Creak.ogg' },
		]);
	});

	it('takes the gain of sounds and tracks from options, defaulting to 1', () => {
		const scan = scanOf({
			sounds: [audio('Boom.mp3', true), audio('Creak.ogg')],
			playlists: [playlist('Combat', [audio('Combat/1.mp3', true), audio('Combat/2.mp3')])],
		});
		const library = buildLibrary(scan, new Map([
			['/music/Boom.mp3.json', { gain: 0.5 }],
			['/music/Combat/1.mp3.json', { title: 'Battle', gain: 0 }],
		]));
		assert.deepEqual(library.sounds.map((sound) => sound.gain), [0.5, 1]);
		assert.deepEqual(library.playlists[0].tracks.map((track) => track.gain), [0, 1]);
	});

	it('sorts sounds and playlists by title', () => {
		const scan = scanOf({
			sounds: [audio('a.mp3', true), audio('b.mp3', true)],
			playlists: [playlist('X', [audio('X/1.mp3')], true), playlist('Y', [audio('Y/1.mp3')])],
		});
		const library = buildLibrary(scan, new Map([
			['/music/a.mp3.json', { title: 'Sound 10' }],
			['/music/b.mp3.json', { title: 'Sound 9' }],
			['/music/X.json', { title: 'Zebra' }],
		]));
		assert.deepEqual(library.sounds.map((sound) => sound.title), ['Sound 9', 'Sound 10']);
		assert.deepEqual(library.playlists.map((entry) => entry.title), ['Y', 'Zebra']);
	});

	it('keeps tracks in path order and uses track titles', () => {
		const scan = scanOf({
			playlists: [playlist('Combat', [audio('Combat/1.mp3', true), audio('Combat/2.mp3')])],
		});
		const library = buildLibrary(scan, new Map([['/music/Combat/1.mp3.json', { title: 'Zzz Last Alphabetically' }]]));
		assert.deepEqual(library.playlists[0].tracks.map((track) => track.title), ['Zzz Last Alphabetically', '2.mp3']);
	});

	it('reads included subdirectories from playlist options', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { includedSubdirectories: ['Boss'] }]]));
		assert.deepEqual(library.playlists.map((entry) => entry.includedSubdirectories), [['Boss'], []]);
	});

	it('hides empty playlists', () => {
		const scan = scanOf({ playlists: [playlist('Empty', []), playlist('Full', [audio('Full/1.mp3')])] });
		assert.deepEqual(buildLibrary(scan, new Map()).playlists.map((entry) => entry.id), ['Full']);
	});

	it('indexes every sound and track by id', () => {
		const scan = scanOf({
			sounds: [audio('Boom.mp3')],
			playlists: [playlist('Combat', [audio('Combat/1.mp3')])],
		});
		const library = buildLibrary(scan, new Map());
		assert.deepEqual([...library.files.keys()], ['Boom.mp3', 'Combat/1.mp3']);
		assert.equal(library.files.get('Combat/1.mp3'), library.playlists[0].tracks[0]);
		assert.equal(library.root, '/music');
	});
});
