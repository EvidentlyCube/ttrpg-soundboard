import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../../helpers/tmp-tree.js';
import { test } from '../support/fixtures.js';

const audio = readFileSync(join(FIXTURES_DIR, 'example_soundboard', 'Sound MP3 no title tag.mp3'));

test.use({
	library: {
		'Boom.mp3': audio,
		'Boom.mp3.json': JSON.stringify({
			source: {
				origin: 'download',
				url: 'https://youtu.be/abc123',
				extractor: 'youtube',
				videoId: 'abc123',
				playlistId: 'PL9',
				chapter: 2,
				chapterStart: 61.9,
			},
		}),
		'Plain.mp3': audio,
		'Song [dQw4w9WgXcQ].mp3': audio,
		'Odd.mp3': audio,
		'Odd.mp3.json': JSON.stringify({ source: { origin: 'edited', url: 'javascript:alert(1)' } }),
		'Rain': {
			'a.mp3': audio,
			'b.mp3': audio,
			'b.mp3.json': JSON.stringify({ source: { origin: 'download', url: 'https://vimeo.com/55', extractor: 'vimeo', videoId: '55' } }),
		},
	},
});

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test.describe('a sound', () => {
	test('Metadata opens a dialog named after the sound', async ({ sounds, dialogs }) => {
		await sounds.useMenu('Boom.mp3', 'Metadata');

		await dialogs.metadata.expectOpen();
		await dialogs.metadata.expectTitle('Metadata: "Boom.mp3"');
		await dialogs.metadata.expectRow('Boom.mp3', 'File', 'Boom.mp3');
	});

	test('a download from YouTube shows where it came from, with links rebuilt from the ids', async ({ sounds, dialogs }) => {
		await sounds.useMenu('Boom.mp3', 'Metadata');

		await dialogs.metadata.expectRow('Boom.mp3', 'Origin', 'Downloaded');
		await dialogs.metadata.expectRow('Boom.mp3', 'Site', 'youtube');
		await dialogs.metadata.expectLink('Boom.mp3', 'Link', 'https://youtu.be/abc123');
		await dialogs.metadata.expectLink('Boom.mp3', 'Video', 'https://www.youtube.com/watch?v=abc123');
		await dialogs.metadata.expectLink('Boom.mp3', 'Playlist', 'https://www.youtube.com/playlist?list=PL9');
		await dialogs.metadata.expectExtraLink('Boom.mp3', 'Playlist', 'in playlist', 'https://www.youtube.com/watch?v=abc123&list=PL9');
	});

	test('the chapter links to the moment it starts, in whole seconds', async ({ sounds, dialogs }) => {
		await sounds.useMenu('Boom.mp3', 'Metadata');

		await dialogs.metadata.expectRow('Boom.mp3', 'Chapter', '2');
		await dialogs.metadata.expectLink('Boom.mp3', 'Chapter', 'https://www.youtube.com/watch?v=abc123&t=61s');
	});

	test('a file with no recorded source says Unknown, and the rest is n/a', async ({ sounds, dialogs }) => {
		await sounds.useMenu('Plain.mp3', 'Metadata');

		await dialogs.metadata.expectRow('Plain.mp3', 'Origin', 'Unknown');
		for (const label of ['Link', 'Site', 'Video', 'Playlist', 'Chapter']) {
			await dialogs.metadata.expectNotAvailable('Plain.mp3', label);
		}
	});

	test('an id in the file name is found there, and the YouTube link is built from it', async ({ sounds, dialogs }) => {
		await sounds.useMenu('Song', 'Metadata');

		await dialogs.metadata.expectRow('Song [dQw4w9WgXcQ].mp3', 'Origin', 'Found in the file name');
		await dialogs.metadata.expectLink('Song [dQw4w9WgXcQ].mp3', 'Video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
	});

	test('a link that is not http(s) is shown as text, never as a link', async ({ sounds, dialogs }) => {
		await sounds.useMenu('Odd.mp3', 'Metadata');

		await dialogs.metadata.expectRow('Odd.mp3', 'Origin', 'Entered by hand');
		await dialogs.metadata.expectRow('Odd.mp3', 'Link', 'javascript:alert(1)');
		await dialogs.metadata.expectNoLink('Odd.mp3', 'Link');
	});

	test('Esc closes the dialog', async ({ sounds, dialogs, page }) => {
		await sounds.useMenu('Boom.mp3', 'Metadata');

		await page.keyboard.press('Escape');

		await dialogs.metadata.expectClosed();
	});
});

test.describe('a playlist', () => {
	test.beforeEach(async ({ playlists }) => {
		await playlists.useMenu('Rain', 'Metadata');
	});

	test('has a card for every track, numbered', async ({ dialogs }) => {
		await dialogs.metadata.expectTitle('Metadata: "Rain"');
		await dialogs.metadata.expectCards(['1. a.mp3', '2. b.mp3']);
		await dialogs.metadata.expectRow('Rain/a.mp3', 'File', 'Rain/a.mp3');
	});

	test('a track from another site links only what that site gives', async ({ dialogs }) => {
		await dialogs.metadata.expectRow('Rain/b.mp3', 'Site', 'vimeo');
		await dialogs.metadata.expectLink('Rain/b.mp3', 'Link', 'https://vimeo.com/55');
		await dialogs.metadata.expectRow('Rain/b.mp3', 'Video', '55');
		await dialogs.metadata.expectNoLink('Rain/b.mp3', 'Video');
	});
});
