import { test } from '../support/fixtures.js';

const ZOO = 'https://www.youtube.com/watch?v=zoo';
const CHAPTERED = 'https://www.youtube.com/watch?v=talk';
const MIX = 'https://www.youtube.com/playlist?list=PL1';

test.describe('without the tools', () => {
	test('the dialog is replaced by a notice that names both programs', async ({ soundboard, sounds, dialogs }) => {
		await soundboard.startAndWaitUntilLoaded();

		await sounds.openAdd();

		await dialogs.add.expectUnavailable('yt-dlp and ffmpeg were not found');
	});

	test.describe('with only yt-dlp', () => {
		test.use({ downloadTools: 'withoutFfmpeg' });

		test('the notice names just the missing one', async ({ soundboard, playlists, dialogs }) => {
			await soundboard.startAndWaitUntilLoaded();

			await playlists.openAdd();

			await dialogs.add.expectUnavailable('ffmpeg was not found when the app started');
		});
	});
});

test.describe('with the tools', () => {
	test.use({ downloadTools: 'both' });

	test.beforeEach(async ({ soundboard, downloads }) => {
		downloads.addVideo(ZOO, { id: 'zoo', title: 'Me at the zoo', duration: 19, size: 1_000_000 });
		downloads.addVideo(CHAPTERED, {
			id: 'talk',
			title: 'The talk',
			duration: 60,
			chapters: [{ title: 'Intro', start: 0, end: 10 }, { title: 'Middle', start: 10, end: 40 }, { title: 'End', start: 40, end: 60 }],
		});
		downloads.addPlaylist(MIX, {
			id: 'PL1',
			title: 'Battle music',
			entries: [{ id: 'a', title: 'Song a' }, { id: 'b', title: 'Song b' }, { id: 'c', title: 'Song c' }],
		});
		downloads.addUnusableLink('https://nothing.test/', 'ERROR: [generic] Unsupported URL');
		await soundboard.startAndWaitUntilLoaded();
	});

	test.describe('adding sound effects', () => {
		test.beforeEach(async ({ sounds, dialogs }) => {
			await sounds.openAdd();
			await dialogs.add.expectOpen();
		});

		test('the dialog opens with a title and the link field ready', async ({ dialogs }) => {
			await dialogs.add.expectTitle('Add sounds');
			await dialogs.add.expectLinkFocused();
		});

		test('Look up with nothing typed does nothing but focus the field', async ({ dialogs }) => {
			await dialogs.add.pressLookUp();

			await dialogs.add.expectLinkFocused();
		});

		test('a video shows its title, length and size on the Download button', async ({ dialogs }) => {
			await dialogs.add.lookUp(ZOO);

			await dialogs.add.expectFound('Me at the zoo');
			await dialogs.add.expectFound('0:19');
			await dialogs.add.expectDownloadButton('Download 1.0 MB');
			await dialogs.add.expectWarning(null);
		});

		test('Enter in the field looks up too', async ({ dialogs }) => {
			await dialogs.add.lookUpWithEnter(ZOO);

			await dialogs.add.expectFound('Me at the zoo');
		});

		test('a link yt-dlp cannot use says why', async ({ dialogs }) => {
			await dialogs.add.lookUp('https://nothing.test/');

			await dialogs.add.expectError('[generic] Unsupported URL');
		});

		test('text that is not a link, and links that are not http, are refused', async ({ dialogs }) => {
			await dialogs.add.lookUp('not a link');
			await dialogs.add.expectError('That is not a link.');

			await dialogs.add.lookUp('ftp://example.test/song.mp3');
			await dialogs.add.expectError('Only http and https links can be downloaded.');
		});

		test('a video of unknown size warns about it, and a huge one says so', async ({ dialogs, downloads }) => {
			downloads.addVideo('https://video.test/unknown', { id: 'unknown', title: 'Unknown size', size: null });
			downloads.addVideo('https://video.test/huge', { id: 'huge', title: 'Huge', size: 700_000_000 });

			await dialogs.add.lookUp('https://video.test/unknown');
			await dialogs.add.expectWarning('The size of this file is unknown.');
			await dialogs.add.expectDownloadButton('Download');

			await dialogs.add.lookUp('https://video.test/huge');
			await dialogs.add.expectWarning('This is a large file.');
			await dialogs.add.expectDownloadButton('Download 700 MB');
		});

		test('a direct link to an audio file shows its name, type and size', async ({ dialogs, downloads }) => {
			downloads.addFile('https://files.test/fanfare.mp3', { name: 'fanfare.mp3', size: 2048 });

			await dialogs.add.lookUp('https://files.test/fanfare.mp3');

			await dialogs.add.expectFound('fanfare.mp3');
			await dialogs.add.expectFound('audio/mpeg');
			await dialogs.add.expectDownloadButton('Download 2.0 KB');
		});

		test('a video with chapters can be split, and each chapter chosen', async ({ dialogs }) => {
			await dialogs.add.lookUp(CHAPTERED);
			await dialogs.add.expectDownloadEnabled(true);

			await dialogs.add.chooseMode('chapters');
			await dialogs.add.expectChosen('3 of 3 chosen');

			await dialogs.add.selectNone();
			await dialogs.add.expectChosen('0 of 3 chosen');
			await dialogs.add.expectDownloadEnabled(false);

			await dialogs.add.choose('1', true);
			await dialogs.add.expectChosen('1 of 3 chosen');
			await dialogs.add.expectDownloadEnabled(true);

			await dialogs.add.selectAll();
			await dialogs.add.expectChosen('3 of 3 chosen');
		});

		test('a playlist lists its entries, all chosen, and needs at least one', async ({ dialogs }) => {
			await dialogs.add.lookUp(MIX);

			await dialogs.add.expectFound('Battle music');
			await dialogs.add.expectFound('3 entries');
			await dialogs.add.expectFound('Song b');
			await dialogs.add.expectChosen('3 of 3 chosen');

			await dialogs.add.selectNone();
			await dialogs.add.expectDownloadEnabled(false);

			await dialogs.add.choose('b', true);
			await dialogs.add.expectDownloadEnabled(true);
		});

		test('a playlist longer than what is listed says so', async ({ dialogs, downloads }) => {
			downloads.addPlaylist('https://video.test/long', {
				id: 'LONG',
				title: 'Everything',
				entries: [{ id: 'x', title: 'Song x' }],
				total: 900,
			});

			await dialogs.add.lookUp('https://video.test/long');

			await dialogs.add.expectFound('Only the first 1 entries are listed.');
		});

		test('a video link that also names a playlist offers the whole playlist instead', async ({ dialogs, downloads }) => {
			const link = 'https://www.youtube.com/watch?v=zoo&list=PL1';
			downloads.addVideo(link, { id: 'zoo', title: 'Me at the zoo' });
			downloads.addPlaylist(link, { id: 'PL1', title: 'Battle music', entries: [{ id: 'a', title: 'Song a' }] });

			await dialogs.add.lookUp(link);
			await dialogs.add.expectWholePlaylistOffered();
			await dialogs.add.showWholePlaylist();

			await dialogs.add.expectFound('Battle music');
			await dialogs.add.expectWholePlaylistOffered(false);
		});

		test('Esc closes the dialog', async ({ dialogs }) => {
			await dialogs.add.pressEscape();

			await dialogs.add.expectClosed();
		});
	});

	test.describe('adding a playlist', () => {
		test.beforeEach(async ({ playlists, dialogs }) => {
			await playlists.openAdd();
			await dialogs.add.expectTitle('Add a playlist');
		});

		test('the title starts as the name of what was found, and cannot be empty', async ({ dialogs }) => {
			await dialogs.add.lookUp(MIX);

			await dialogs.add.expectPlaylistTitle('Battle music');
			await dialogs.add.expectDownloadEnabled(true);

			await dialogs.add.setPlaylistTitle('   ');
			await dialogs.add.expectDownloadEnabled(false);

			await dialogs.add.setPlaylistTitle('Fights');
			await dialogs.add.expectDownloadEnabled(true);
		});

		test('a direct file starts the title as its name without the extension', async ({ dialogs, downloads }) => {
			downloads.addFile('https://files.test/rain.mp3', { name: 'rain.mp3' });

			await dialogs.add.lookUp('https://files.test/rain.mp3');

			await dialogs.add.expectPlaylistTitle('rain');
		});
	});

	test.describe("adding tracks from a playlist's dialog", () => {
		test.beforeEach(async ({ playlists, dialogs }) => {
			await playlists.useMenu('Music MP3', 'Customize');
			await dialogs.playlistEditor.openTracksTab();
			await dialogs.playlistEditor.addTracks();
		});

		test('opens an Add dialog named after the playlist', async ({ dialogs }) => {
			await dialogs.add.expectTitle('Add tracks to Music MP3');
		});

		test('closing it brings the playlist dialog back on the Tracks tab', async ({ dialogs }) => {
			await dialogs.add.pressEscape();

			await dialogs.add.expectClosed();
			await dialogs.playlistEditor.expectOpen();
			await dialogs.playlistEditor.expectTabSelected('tracks');
		});
	});
});
