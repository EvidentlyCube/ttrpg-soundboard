import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { audioFormatOf, classifyDirectory } from '../../../src/library/classify.js';

/**
 * @param {string} name
 * @returns {import('../../../src/library/classify.js').DirectoryEntry}
 */
const file = (name) => ({ name, kind: 'file' });
/**
 * @param {string} name
 * @returns {import('../../../src/library/classify.js').DirectoryEntry}
 */
const directory = (name) => ({ name, kind: 'directory' });

describe('audioFormatOf', () => {
	it('recognizes supported extensions case-insensitively', () => {
		assert.equal(audioFormatOf('a.mp3'), 'mp3');
		assert.equal(audioFormatOf('a.MP3'), 'mp3');
		assert.equal(audioFormatOf('b.ogg'), 'ogg');
		assert.equal(audioFormatOf('b.Ogg'), 'ogg');
	});

	it('returns null for anything else', () => {
		assert.equal(audioFormatOf('a.wav'), null);
		assert.equal(audioFormatOf('mp3'), null);
		assert.equal(audioFormatOf('a.mp3.json'), null);
	});
});

describe('classifyDirectory', () => {
	it('separates audio files, directories and options files', () => {
		const result = classifyDirectory([
			file('Boom.mp3'),
			file('Boom.mp3.json'),
			file('Creak.ogg'),
			directory('Combat'),
			file('Combat.json'),
			directory('Tavern'),
		], { isRoot: true });

		assert.deepEqual(result.audioFiles, [{ name: 'Boom.mp3', format: 'mp3' }, { name: 'Creak.ogg', format: 'ogg' }]);
		assert.deepEqual(result.directories, ['Combat', 'Tavern']);
		assert.deepEqual([...result.audioWithOptions], ['Boom.mp3']);
		assert.deepEqual([...result.directoriesWithOptions], ['Combat']);
		assert.deepEqual(result.orphanOptions, []);
	});

	it('treats directory options outside the root as orphans', () => {
		const result = classifyDirectory([directory('Boss'), file('Boss.json')], { isRoot: false });
		assert.deepEqual([...result.directoriesWithOptions], []);
		assert.deepEqual(result.orphanOptions, ['Boss.json']);
	});

	it('reports options files that match nothing as orphans', () => {
		const result = classifyDirectory([file('Gone.mp3.json'), file('notes.json'), file('Boom.mp3')], { isRoot: true });
		assert.deepEqual(result.orphanOptions, ['Gone.mp3.json', 'notes.json']);
	});

	it('requires the options name to match the audio name exactly', () => {
		const result = classifyDirectory([file('Boom.mp3'), file('Boom.MP3.json')], { isRoot: true });
		assert.deepEqual([...result.audioWithOptions], []);
		assert.deepEqual(result.orphanOptions, ['Boom.MP3.json']);
	});

	it('ignores hidden entries', () => {
		const result = classifyDirectory([
			file('.soundboard'),
			file('.DS_Store'),
			file('._Boom.mp3'),
			directory('.git'),
			file('.hidden.json'),
		], { isRoot: true });
		assert.deepEqual(result, classifyDirectory([], { isRoot: true }));
	});

	it('reports unsupported audio files and ignores other files silently', () => {
		const result = classifyDirectory([
			file('Song.wav'),
			file('Song.FLAC'),
			file('cover.jpg'),
			file('readme.txt'),
		], { isRoot: true });
		assert.deepEqual(result.unsupportedAudio, ['Song.wav', 'Song.FLAC']);
		assert.deepEqual(result.audioFiles, []);
	});

	it('reports symlinks and ignores other entry kinds', () => {
		const result = classifyDirectory([
			{ name: 'Linked.mp3', kind: 'symlink' },
			{ name: 'socket', kind: 'other' },
		], { isRoot: true });
		assert.deepEqual(result.symlinks, ['Linked.mp3']);
		assert.deepEqual(result.audioFiles, []);
	});

	it('treats a directory with an audio extension as a directory', () => {
		const result = classifyDirectory([directory('Weird.mp3'), file('Weird.mp3.json')], { isRoot: true });
		assert.deepEqual(result.directories, ['Weird.mp3']);
		assert.deepEqual([...result.directoriesWithOptions], ['Weird.mp3']);
		assert.deepEqual(result.audioFiles, []);
	});
});
