import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnusableLinkError } from '../../../src/downloads/errors.js';
import { failureMessage, MAX_ENTRIES, parseLink, toProbe } from '../../../src/downloads/probe.js';

const VIDEO_LINK = parseLink('https://www.youtube.com/watch?v=jNQXAC9IVRw');

/** What `yt-dlp -J` prints for a video, cut down to the fields the app reads. */
const VIDEO = {
	_type: 'video',
	id: 'jNQXAC9IVRw',
	title: 'Me at the zoo',
	duration: 19,
	filesize: 252182,
	filesize_approx: 252180,
	extractor_key: 'Youtube',
	webpage_url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
	is_live: false,
	live_status: 'not_live',
	chapters: [
		{ start_time: 0, title: 'Intro', end_time: 5 },
		{ start_time: 5, title: 'The cool thing', end_time: 17 },
		{ start_time: 17, title: 'End', end_time: 19 },
	],
};

/** @param {number} count */
function playlist(count, extra = {}) {
	return {
		_type: 'playlist',
		id: 'UU4QobU6STFB0P71PMvOGN5A',
		title: 'Uploads from jawed',
		extractor_key: 'YoutubeTab',
		webpage_url: 'https://www.youtube.com/playlist?list=UU4QobU6STFB0P71PMvOGN5A',
		entries: Array.from({ length: count }, (_, index) => ({
			_type: 'url', ie_key: 'Youtube', id: `id${index}`, title: `Video ${index}`, duration: 60, url: `https://www.youtube.com/watch?v=id${index}`,
		})),
		...extra,
	};
}

describe('parseLink', () => {
	it('accepts http and https links, trimmed', () => {
		assert.equal(parseLink('  https://example.com/a.mp3 ').href, 'https://example.com/a.mp3');
		assert.equal(parseLink('http://example.com/').protocol, 'http:');
	});

	it('refuses anything else', () => {
		assert.throws(() => parseLink('not a link'), UnusableLinkError);
		assert.throws(() => parseLink('file:///etc/passwd'), /Only http and https/);
	});
});

describe('toProbe', () => {
	it('reduces a video to its title, duration, size, site and chapters', () => {
		assert.deepEqual(toProbe(VIDEO, VIDEO_LINK), {
			kind: 'video',
			url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
			id: 'jNQXAC9IVRw',
			title: 'Me at the zoo',
			duration: 19,
			size: 252182,
			extractor: 'Youtube',
			chapters: [{ title: 'Intro', start: 0, end: 5 }, { title: 'The cool thing', start: 5, end: 17 }, { title: 'End', start: 17, end: 19 }],
			playlistAvailable: false,
		});
	});

	it('falls back to the approximate size, and to the duration for a last chapter without an end', () => {
		const probe = toProbe({ ...VIDEO, filesize: null, chapters: [{ start_time: 10, title: 'Late' }] }, VIDEO_LINK);
		assert.equal(probe.kind === 'video' && probe.size, 252180);
		assert.deepEqual(probe.kind === 'video' && probe.chapters, [{ title: 'Late', start: 10, end: 19 }]);
	});

	it('says when the link also names a playlist', () => {
		const probe = toProbe(VIDEO, parseLink('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1'));
		assert.equal(probe.kind === 'video' && probe.playlistAvailable, true);
	});

	it('refuses live streams', () => {
		assert.throws(() => toProbe({ ...VIDEO, is_live: true }, VIDEO_LINK), /Live streams/);
		assert.throws(() => toProbe({ ...VIDEO, live_status: 'is_upcoming' }, VIDEO_LINK), /Live streams/);
	});

	it('lists a playlist\'s entries with the site of each', () => {
		assert.deepEqual(toProbe(playlist(2), VIDEO_LINK), {
			kind: 'playlist',
			url: 'https://www.youtube.com/playlist?list=UU4QobU6STFB0P71PMvOGN5A',
			id: 'UU4QobU6STFB0P71PMvOGN5A',
			title: 'Uploads from jawed',
			entries: [
				{ id: 'id0', title: 'Video 0', duration: 60, url: 'https://www.youtube.com/watch?v=id0', extractor: 'Youtube' },
				{ id: 'id1', title: 'Video 1', duration: 60, url: 'https://www.youtube.com/watch?v=id1', extractor: 'Youtube' },
			],
			truncated: false,
		});
	});

	it('skips entries that are lists themselves, such as a channel\'s tabs', () => {
		const probe = toProbe(playlist(1, {
			entries: [...playlist(1).entries, { _type: 'url', ie_key: 'YoutubeTab', id: 'tab', url: 'https://www.youtube.com/@x/shorts' }],
		}), VIDEO_LINK);
		assert.deepEqual(probe.kind === 'playlist' && probe.entries.map((entry) => entry.id), ['id0']);
		assert.throws(() => toProbe(playlist(0), VIDEO_LINK), /nothing that can be downloaded/);
	});

	it(`lists at most ${MAX_ENTRIES} entries and says when there are more`, () => {
		const full = toProbe(playlist(MAX_ENTRIES), VIDEO_LINK);
		assert.equal(full.kind === 'playlist' && full.truncated, true);
		const counted = toProbe(playlist(3, { playlist_count: 3 }), VIDEO_LINK);
		assert.equal(counted.kind === 'playlist' && counted.truncated, false);
		const more = toProbe(playlist(3, { playlist_count: 40 }), VIDEO_LINK);
		assert.equal(more.kind === 'playlist' && more.truncated, true);
	});
});

describe('failureMessage', () => {
	it('takes yt-dlp\'s last error line without its prefix', () => {
		assert.equal(failureMessage(['WARNING: slow', 'ERROR: [generic] Unsupported URL: https://example.com/', 'done']), '[generic] Unsupported URL: https://example.com/');
		assert.equal(failureMessage(['something broke', '']), 'something broke');
		assert.equal(failureMessage([]), 'yt-dlp failed without saying why.');
	});
});
