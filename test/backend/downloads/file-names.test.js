import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chapterFileName, safeFileName, titleFromFileName, uniqueName, withExtension } from '../../../src/downloads/file-names.js';

describe('safeFileName', () => {
	it('removes characters file systems refuse and control characters', () => {
		assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j\u0007.mp3'), 'abcdefghij.mp3');
	});

	it('strips leading dots and spaces, which would hide the file', () => {
		assert.equal(safeFileName(' ..hidden.mp3'), 'hidden.mp3');
	});

	it('shortens long names but keeps the extension', () => {
		const name = safeFileName(`${'x'.repeat(300)}.ogg`);
		assert.equal(name, `${'x'.repeat(120)}.ogg`);
	});

	it('falls back when nothing is left', () => {
		assert.equal(safeFileName('...'), 'download');
		assert.equal(safeFileName('???', 'Playlist'), 'Playlist');
	});
});

describe('withExtension', () => {
	it('replaces the extension, or adds one', () => {
		assert.equal(withExtension('Me at the zoo [jNQXAC9IVRw].webm', '.ogg'), 'Me at the zoo [jNQXAC9IVRw].ogg');
		assert.equal(withExtension('noext', '.ogg'), 'noext.ogg');
	});
});

describe('chapterFileName', () => {
	it('names a chapter as yt-dlp --split-chapters would', () => {
		assert.equal(chapterFileName('Me at the zoo [jNQXAC9IVRw].webm', 3, 'End', 'jNQXAC9IVRw'), 'Me at the zoo - 003 End [jNQXAC9IVRw].ogg');
	});

	it('cleans the chapter title, and works without an id tag', () => {
		assert.equal(chapterFileName('Album.m4a', 12, 'Side A/B', 'x'), 'Album - 012 Side AB.ogg');
	});
});

describe('titleFromFileName', () => {
	it("drops the extension and only the downloaded video's own id tag", () => {
		assert.equal(titleFromFileName('Song [Live] [jNQXAC9IVRw].ogg', 'jNQXAC9IVRw'), 'Song [Live]');
		assert.equal(titleFromFileName('Me at the zoo - 001 Intro [jNQXAC9IVRw].ogg', 'jNQXAC9IVRw'), 'Me at the zoo - 001 Intro');
		assert.equal(titleFromFileName('Rain.loop.mp3', null), 'Rain.loop');
	});
});

describe('uniqueName', () => {
	it('adds (2), (3)… before the extension until the name is free', async () => {
		const taken = new Set(['Rain.ogg', 'Rain (2).ogg']);
		assert.equal(await uniqueName('Rain.ogg', async (name) => taken.has(name)), 'Rain (3).ogg');
		assert.equal(await uniqueName('Combat', async (name) => name === 'Combat'), 'Combat (2)');
		assert.equal(await uniqueName('Free.mp3', async () => false), 'Free.mp3');
	});
});
