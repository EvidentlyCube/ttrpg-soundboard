import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { guessSource, parseYoutubeLink, titleWithoutId, videoIdFromFileName } from '../../../src/library/sources.js';
import { validateAudioOptions } from '../../../src/library/validate.js';

const ID = 'dQw4w9WgXcQ';

describe('videoIdFromFileName', () => {
	it('takes the last brackets before the extension, as yt-dlp names files', () => {
		assert.equal(videoIdFromFileName(`Battle Theme [${ID}].ogg`), ID);
		assert.equal(videoIdFromFileName(`Album - 003 Intro [${ID}].ogg`), ID);
		assert.equal(videoIdFromFileName(`[Live] Song [${ID}].mp3`), ID);
	});

	it('needs exactly 11 id characters, last in the name', () => {
		assert.equal(videoIdFromFileName('Song [Remastered].mp3'), null);
		assert.equal(videoIdFromFileName(`Song [${ID}] extra.mp3`), null);
		assert.equal(videoIdFromFileName('Song [dQw4w9WgXc!].mp3'), null);
		assert.equal(videoIdFromFileName('Song.mp3'), null);
	});

	it('accepts any 11-character word in that place', () => {
		assert.equal(videoIdFromFileName('Song [Instrumentl].mp3'), 'Instrumentl');
	});
});

describe('parseYoutubeLink', () => {
	it('reads the known forms of YouTube links', () => {
		for (const link of [
			`https://www.youtube.com/watch?v=${ID}`,
			`https://m.youtube.com/watch?v=${ID}&t=10`,
			`https://music.youtube.com/watch?v=${ID}`,
			`https://youtu.be/${ID}`,
			`https://www.youtube.com/shorts/${ID}`,
			`https://www.youtube.com/embed/${ID}`,
			`https://www.youtube.com/live/${ID}`,
		]) {
			assert.deepEqual(parseYoutubeLink(link), { videoId: ID, playlistId: null }, link);
		}
	});

	it('reads the playlist from the list parameter', () => {
		assert.deepEqual(parseYoutubeLink(`https://www.youtube.com/watch?v=${ID}&list=PL123`), { videoId: ID, playlistId: 'PL123' });
	});

	it('refuses other sites, other pages and malformed links', () => {
		assert.equal(parseYoutubeLink(`https://example.com/watch?v=${ID}`), null);
		assert.equal(parseYoutubeLink('https://www.youtube.com/playlist?list=PL123'), null);
		assert.equal(parseYoutubeLink('https://www.youtube.com/watch?v=short'), null);
		assert.equal(parseYoutubeLink('not a link'), null);
	});
});

describe('guessSource', () => {
	it('builds a YouTube source from an id in the file name, ignoring the tags', () => {
		assert.deepEqual(guessSource(`Song [${ID}].mp3`, 'https://example.com/x'), {
			origin: 'fileName', url: `https://www.youtube.com/watch?v=${ID}`, extractor: 'Youtube', videoId: ID,
		});
	});

	it('takes a link from the tags, with YouTube ids when it is a YouTube link', () => {
		assert.deepEqual(guessSource('Song.mp3', `https://youtu.be/${ID}?list=PL1`), {
			origin: 'tags', url: `https://youtu.be/${ID}?list=PL1`, extractor: 'Youtube', videoId: ID, playlistId: 'PL1',
		});
		assert.deepEqual(guessSource('Song.mp3', 'https://example.com/song'), { origin: 'tags', url: 'https://example.com/song' });
	});

	it('marks the origin as unknown otherwise', () => {
		assert.deepEqual(guessSource('Song.mp3', null), { origin: 'unknown' });
	});
});

describe('titleWithoutId', () => {
	it('turns a title that is still the file name into the name without extension and id', () => {
		assert.equal(titleWithoutId(`Battle [${ID}].ogg`, `Battle [${ID}].ogg`, ID), 'Battle');
		assert.equal(titleWithoutId(undefined, `Battle [${ID}].ogg`, ID), 'Battle');
	});

	it('only takes the id out of a title the user changed', () => {
		assert.equal(titleWithoutId(`Boss Fight [${ID}].ogg`, `Battle [${ID}].ogg`, ID), 'Boss Fight.ogg');
		assert.equal(titleWithoutId('Boss Fight', `Battle [${ID}].ogg`, ID), 'Boss Fight');
	});

	it('keeps a title that would be empty', () => {
		assert.equal(titleWithoutId(`[${ID}]`, `x [${ID}].ogg`, ID), `[${ID}]`);
	});
});

describe('source validation', () => {
	it('accepts the five origins and a chapter start', () => {
		for (const origin of ['download', 'fileName', 'tags', 'unknown', 'edited']) {
			assert.deepEqual(validateAudioOptions({ source: { origin } }), [], origin);
		}
		assert.deepEqual(validateAudioOptions({ source: { url: 'x', chapter: 2, chapterStart: 61.5 } }), []);
	});

	it('refuses an unknown origin and a bad chapter start', () => {
		assert.equal(validateAudioOptions({ source: { origin: 'manual' } }).length, 1);
		assert.equal(validateAudioOptions({ source: { chapterStart: -1 } }).length, 1);
		assert.equal(validateAudioOptions({ source: { chapterStart: '10' } }).length, 1);
	});
});
