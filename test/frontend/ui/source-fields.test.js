import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourceRows } from '../../../public/app/ui/source-fields.js';

/** @param {ReturnType<typeof sourceRows>} rows */
const byKey = (rows) => Object.fromEntries(rows.map((row) => [row.key, row]));

describe('sourceRows', () => {
	it('lists the fields in order, each n/a without a source', () => {
		const rows = sourceRows(null);
		assert.deepEqual(rows.map((row) => row.label), ['Origin', 'Link', 'Site', 'Video', 'Playlist', 'Chapter']);
		assert.ok(rows.every((row) => row.value === null && row.href === null && row.extra === null));
	});

	it('rebuilds YouTube links from the ids', () => {
		const rows = byKey(sourceRows({
			origin: 'download',
			url: 'https://youtu.be/abcdefghijk',
			extractor: 'Youtube',
			videoId: 'abcdefghijk',
			playlistId: 'PL1',
			chapter: 3,
			chapterStart: 61.7,
		}));
		assert.equal(rows.origin.value, 'Downloaded');
		assert.equal(rows.url.href, 'https://youtu.be/abcdefghijk');
		assert.equal(rows.videoId.href, 'https://www.youtube.com/watch?v=abcdefghijk');
		assert.equal(rows.playlistId.href, 'https://www.youtube.com/playlist?list=PL1');
		assert.deepEqual(rows.playlistId.extra, { label: 'in playlist', href: 'https://www.youtube.com/watch?v=abcdefghijk&list=PL1' });
		assert.equal(rows.chapter.value, '3');
		assert.equal(rows.chapter.href, 'https://www.youtube.com/watch?v=abcdefghijk&t=61s');
	});

	it('links a chapter only when its start is known', () => {
		const rows = byKey(sourceRows({ origin: 'download', extractor: 'Youtube', videoId: 'abcdefghijk', chapter: 2 }));
		assert.equal(rows.chapter.value, '2');
		assert.equal(rows.chapter.href, null);
	});

	it('links only the url for other sites, and never anything but http(s)', () => {
		const rows = byKey(sourceRows({ origin: 'tags', url: 'https://example.com/x', extractor: 'Bandcamp', videoId: '123' }));
		assert.equal(rows.url.href, 'https://example.com/x');
		assert.equal(rows.videoId.href, null);
		assert.equal(byKey(sourceRows({ origin: 'tags', url: 'javascript:alert(1)' })).url.href, null);
	});

	it('names each origin', () => {
		assert.equal(byKey(sourceRows({ origin: 'fileName' })).origin.value, 'Found in the file name');
		assert.equal(byKey(sourceRows({ origin: 'unknown' })).origin.value, 'Unknown');
	});
});
