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
		modified: '2026-10-24T16:41:00.000Z',
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
		const defaults = { size: 100, gain: 1, duration: null, startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0, source: null };
		assert.deepEqual(library.sounds, [
			{ id: 'Boom.mp3', title: 'Big Boom', format: 'mp3', ...defaults, absolutePath: '/music/Boom.mp3' },
			{ id: 'Creak.ogg', title: 'Creak.ogg', format: 'ogg', ...defaults, absolutePath: '/music/Creak.ogg' },
		]);
	});

	it('takes start and end points and fades of sounds and tracks from options', () => {
		const scan = scanOf({
			sounds: [audio('Boom.mp3', true)],
			playlists: [playlist('Combat', [audio('Combat/1.mp3', true)])],
		});
		const library = buildLibrary(scan, new Map([
			['/music/Boom.mp3.json', { startAt: 0.25, endAt: 1.5, fadeIn: 0.1, fadeOut: 0.2 }],
			['/music/Combat/1.mp3.json', { startAt: 3 }],
		]));
		const { startAt, endAt, fadeIn, fadeOut } = library.sounds[0];
		assert.deepEqual({ startAt, endAt, fadeIn, fadeOut }, { startAt: 0.25, endAt: 1.5, fadeIn: 0.1, fadeOut: 0.2 });
		assert.deepEqual([library.playlists[0].tracks[0].startAt, library.playlists[0].tracks[0].endAt], [3, null]);
	});

	it('takes the measured duration from options', () => {
		const scan = scanOf({ sounds: [audio('Boom.mp3', true)] });
		const measuredFrom = { size: 100, modified: '2026-10-24T16:41:00.000Z', sha1: 'a'.repeat(40) };
		const library = buildLibrary(scan, new Map([['/music/Boom.mp3.json', { duration: 4.5, measuredFrom }]]));
		assert.equal(library.sounds[0].duration, 4.5);
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

	it('takes the playlist gain from options, defaulting to 1', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { gain: 2 }]]));
		assert.deepEqual(library.playlists.map((entry) => entry.gain), [2, 1]);
	});

	it('takes the playlist crossfade from options, defaulting to 0', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { crossfade: 2.5 }]]));
		assert.deepEqual(library.playlists.map((entry) => entry.crossfade), [2.5, 0]);
	});

	it('takes the playlist fades from options, defaulting to 0', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { fadeIn: 1.5, fadeOut: 3 }]]));
		assert.deepEqual(library.playlists.map((entry) => [entry.fadeIn, entry.fadeOut]), [[1.5, 3], [0, 0]]);
	});

	it('takes the playlist order from options, defaulting to ordered', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { order: 'shuffle' }]]));
		assert.deepEqual(library.playlists.map((entry) => entry.order), ['shuffle', 'ordered']);
	});

	it('takes playlist looping from options, defaulting to on', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { playlistLooping: false }]]));
		assert.deepEqual(library.playlists.map((entry) => entry.playlistLooping), [false, true]);
	});

	it('takes track looping from options, defaulting to off', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { trackLooping: true }]]));
		assert.deepEqual(library.playlists.map((entry) => entry.trackLooping), [true, false]);
	});

	it('takes the stop mode from options, defaulting to resetPlaylist', () => {
		const scan = scanOf({ playlists: [playlist('A', [audio('A/1.mp3')], true), playlist('B', [audio('B/1.mp3')])] });
		const library = buildLibrary(scan, new Map([['/music/A.json', { stopMode: 'pause' }]]));
		assert.deepEqual(library.playlists.map((entry) => entry.stopMode), ['pause', 'resetPlaylist']);
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
