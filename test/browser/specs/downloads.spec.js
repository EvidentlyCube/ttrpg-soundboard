import { expect, test } from '../support/fixtures.js';

const ZOO = 'https://www.youtube.com/watch?v=zoo';
const TALK = 'https://www.youtube.com/watch?v=talk';
const MIX = 'https://www.youtube.com/playlist?list=PL1';

test.use({ downloadTools: 'both' });

test.beforeEach(async ({ soundboard, downloads }) => {
	downloads.addVideo(ZOO, { id: 'zoo', title: 'Me at the zoo', duration: 19, size: 1_000_000 });
	downloads.addVideo(TALK, {
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
	await soundboard.startAndWaitUntilLoaded();
});

test.describe('a video as a sound effect', () => {
	test.beforeEach(async ({ sounds, dialogs }) => {
		await sounds.openAdd();
		await dialogs.add.lookUp(ZOO);
	});

	test("the dialog shows the progress and the tool's output, then closes with the new tile in place", async ({ sounds, dialogs, downloads }) => {
		downloads.hold();
		await dialogs.add.download();

		await dialogs.add.expectClosed();
		await dialogs.download.expectOpen();
		await dialogs.download.expectHeading('Downloading Me at the zoo');
		await dialogs.download.expectTarget('Adding sound effects');
		await dialogs.download.expectCurrent('Item 1 of 1: Me at the zoo');
		await dialogs.download.expectLog('$ yt-dlp');
		await dialogs.download.expectLog('[download]  42.0%');
		await dialogs.download.expectButton('cancel');

		downloads.release();

		await dialogs.download.expectHeading('Download finished');
		await dialogs.download.expectSummary('1 added.');
		await dialogs.download.expectLog('[download] 100%');
		await dialogs.download.expectButton('close');
		await dialogs.download.close();
		await dialogs.download.expectClosed();
		await sounds.expectShown('Me at the zoo');
	});

	test('the new sound plays', async ({ sounds, dialogs, audio }) => {
		await dialogs.add.download();
		await dialogs.download.expectSummary('1 added.');
		await dialogs.download.close();

		await sounds.click('Me at the zoo');

		await audio.expectPlaying('Me at the zoo');
	});

	test('a download that fails says which item and why', async ({ dialogs, downloads, sounds }) => {
		downloads.failVideo('zoo', 'Video unavailable');
		await dialogs.add.download();

		await dialogs.download.expectHeading('Download finished with errors');
		await dialogs.download.expectSummary('0 added, 1 failed.');
		await dialogs.download.expectSummary('Video unavailable');
		await dialogs.download.close();
		await sounds.expectGone('Me at the zoo');
	});

	test('Cancel asks first, and changing your mind lets it run', async ({ dialogs, downloads }) => {
		downloads.hold();
		await dialogs.add.download();
		await dialogs.download.expectButton('cancel');

		await dialogs.download.cancelButChangeMind();

		await dialogs.download.expectHeading('Downloading Me at the zoo');
		await dialogs.download.expectButton('cancel');
	});

	test('cancelling stops the tool and ends the download', async ({ dialogs, downloads, sounds }) => {
		downloads.hold();
		await dialogs.add.download();
		await dialogs.download.expectButton('cancel');

		await dialogs.download.cancel();

		await dialogs.download.expectHeading('Download cancelled');
		await dialogs.download.expectSummary('the rest cancelled');
		await dialogs.download.expectButton('close');
		await dialogs.download.close();
		await sounds.expectGone('Me at the zoo');
		expectKilled(downloads);
	});

	test('every tab shows the download, and closing it in one closes it in all', async ({ context, soundboard, dialogs, downloads }) => {
		downloads.hold();
		await dialogs.add.download();
		await dialogs.download.expectOpen();

		const other = await context.newPage();
		await other.goto(soundboard.url);
		await other.locator('[data-start-mode=standalone]').click();
		const otherDialog = other.getByRole('dialog', { name: 'Download' });
		await expect(otherDialog.getByRole('heading', { name: 'Downloading Me at the zoo' })).toBeVisible();

		downloads.release();
		await dialogs.download.expectSummary('1 added.');
		await dialogs.download.close();

		await expect(otherDialog).toBeHidden();
		await other.close();
	});

	test('only one download runs at a time, so a second is refused', async ({ page, soundboard, dialogs, downloads }) => {
		downloads.hold();
		await dialogs.add.download();
		await dialogs.download.expectOpen();

		const probe = await page.request.post(`${soundboard.url}/api/download/probe`, { data: { url: ZOO } });
		const { probeId } = await probe.json();
		const second = await page.request.post(`${soundboard.url}/api/download`, { data: { probeId, target: { kind: 'sound' } } });

		expect(second.status()).toBe(409);
		downloads.release();
		await dialogs.download.expectSummary('1 added.');
	});

	test('a reload while it runs brings the dialog and its log back', async ({ soundboard, splash, dialogs, downloads }) => {
		downloads.hold();
		await dialogs.add.download();
		await dialogs.download.expectLog('[download]  42.0%');

		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();

		await dialogs.download.expectOpen();
		await dialogs.download.expectHeading('Downloading Me at the zoo');
		await dialogs.download.expectLog('[download]  42.0%');
		downloads.release();
		await dialogs.download.expectSummary('1 added.');
	});
});

test.describe('a video split into chapters', () => {
	test('adds one sound per chosen chapter', async ({ sounds, dialogs }) => {
		await sounds.openAdd();
		await dialogs.add.lookUp(TALK);
		await dialogs.add.chooseMode('chapters');
		await dialogs.add.choose('1', false);

		await dialogs.add.download();

		await dialogs.download.expectSummary('2 added.');
		await dialogs.download.close();
		await sounds.expectShown('The talk - 001 Intro', 'The talk - 003 End');
		await sounds.expectGone('The talk - 002 Middle');
	});
});

test.describe('a direct link to an audio file', () => {
	test('is fetched and added by its name', async ({ sounds, dialogs, downloads }) => {
		downloads.addFile('https://files.test/fanfare.mp3', { name: 'fanfare.mp3', size: 3 });
		await sounds.openAdd();
		await dialogs.add.lookUp('https://files.test/fanfare.mp3');

		await dialogs.add.download();

		await dialogs.download.expectSummary('1 added.');
		await dialogs.download.close();
		await sounds.expectShown('fanfare');
	});
});

test.describe('a playlist of videos as a new playlist', () => {
	test.beforeEach(async ({ playlists, dialogs }) => {
		await playlists.openAdd();
		await dialogs.add.lookUp(MIX);
	});

	test('creates the playlist with the chosen entries as its tracks', async ({ playlists, dialogs }) => {
		await dialogs.add.setPlaylistTitle('Fights');
		await dialogs.add.choose('b', false);

		await dialogs.add.download();

		await dialogs.download.expectTarget('Adding to Fights');
		await dialogs.download.expectSummary('2 added.');
		await dialogs.download.close();
		await playlists.expectShown('Fights');
		await playlists.expectStatus('Fights', '2 tracks');
	});

	test('one entry that fails does not stop the others', async ({ playlists, dialogs, downloads }) => {
		downloads.failVideo('b', 'Video b is private');

		await dialogs.add.download();

		await dialogs.download.expectSummary('2 added, 1 failed.');
		await dialogs.download.expectSummary('Video b is private');
		await dialogs.download.close();
		await playlists.expectStatus('Battle music', '2 tracks');
	});
});

test.describe('tracks added to an existing playlist', () => {
	test.beforeEach(async ({ playlists, dialogs }) => {
		await playlists.useMenu('Music MP3', 'Customize');
		await dialogs.playlistEditor.openTracksTab();
		await dialogs.playlistEditor.addTracks();
		await dialogs.add.lookUp(ZOO);
	});

	test('arrive at once, and the playlist dialog comes back on the Tracks tab when the download is closed', async ({ dialogs }) => {
		await dialogs.add.download();
		await dialogs.download.expectTarget('Adding to Music MP3');
		await dialogs.download.expectSummary('1 added.');

		await dialogs.download.close();

		await dialogs.playlistEditor.expectOpen();
		await dialogs.playlistEditor.expectTabSelected('tracks');
		await dialogs.playlistEditor.expectTracksTab('Tracks (3)');
		await dialogs.playlistEditor.expectTrackTitles(['Me at the zoo', 'Piece by Piece', 'Intro']);
	});
});

test('a track added to a playlist that is playing can be reached from its bar', async ({ playlists, footer, dialogs, audio }) => {
	await playlists.click('Music MP3');
	await audio.expectPlaying('Piece by Piece');
	await playlists.useMenu('Music MP3', 'Customize');
	await dialogs.playlistEditor.openTracksTab();
	await dialogs.playlistEditor.addTracks();
	await dialogs.add.lookUp(ZOO);

	await dialogs.add.download();
	await dialogs.download.expectSummary('1 added.');
	await dialogs.download.close();
	await dialogs.playlistEditor.close();

	const player = footer.player('Music MP3');
	await player.openTrackList();
	await player.expectTrackList(['Me at the zoo', 'Piece by Piece', 'Intro']);
	await player.jumpTo('Me at the zoo');
	await audio.expectPlaying('Me at the zoo');
});

/**
 * @param {import('../support/downloads.js').FakeDownloads} downloads
 */
function expectKilled(downloads) {
	const ytDlp = downloads.calls.filter((call) => call.command === 'yt-dlp' && !call.args.includes('-J'));
	if (!ytDlp.some((call) => call.killed)) {
		throw new Error('The download was not stopped');
	}
}
