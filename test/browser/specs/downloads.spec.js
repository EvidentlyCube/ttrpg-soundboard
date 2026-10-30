import { expect, test } from '../support/fixtures.js';

const ZOO = 'https://www.youtube.com/watch?v=zoo';
const TALK = 'https://www.youtube.com/watch?v=talk';
const MIX = 'https://www.youtube.com/playlist?list=PL1';

test.use({ downloadTools: 'both' });

test.beforeEach(async ({ soundboard, downloads }) => {
	await test.step('Teach the fake tools a video, a chaptered video and a playlist', async () => {
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
	});

	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test.describe('a video as a sound effect', () => {
	test.beforeEach(async ({ sounds, dialogs }) => {
		await test.step('Look up the video in the Add dialog', async () => {
			await sounds.openAdd();
			await dialogs.add.lookUp(ZOO);
		});
	});

	test("the dialog shows the progress and the tool's output, then closes with the new tile in place", async ({ sounds, dialogs, downloads }) => {
		await test.step('Hold the tool so the download stays in progress, then click Download', async () => {
			downloads.hold();
			await dialogs.add.download();
		});

		await test.step('The Add dialog gives way to the progress dialog', async () => {
			await dialogs.add.expectClosed();
			await dialogs.download.expectOpen();
		});

		await test.step("It shows what is downloading, the tool's output and a Cancel button", async () => {
			await dialogs.download.expectHeading('Downloading Me at the zoo');
			await dialogs.download.expectTarget('Adding sound effects');
			await dialogs.download.expectCurrent('Item 1 of 1: Me at the zoo');
			await dialogs.download.expectLog('$ yt-dlp');
			await dialogs.download.expectLog('[download]  42.0%');
			await dialogs.download.expectButton('cancel');
		});

		await test.step('Let the tool finish: the dialog says so and offers Close', async () => {
			downloads.release();
			await dialogs.download.expectHeading('Download finished');
			await dialogs.download.expectSummary('1 added.');
			await dialogs.download.expectLog('[download] 100%');
			await dialogs.download.expectButton('close');
		});

		await test.step('Close it: the new tile is in place', async () => {
			await dialogs.download.close();
			await dialogs.download.expectClosed();
			await sounds.expectShown('Me at the zoo');
		});
	});

	test('the new sound plays', async ({ sounds, dialogs, audio }) => {
		await test.step('Download the video and close the dialog', async () => {
			await dialogs.add.download();
			await dialogs.download.expectSummary('1 added.');
			await dialogs.download.close();
		});

		await test.step('Click the new sound', async () => {
			await sounds.click('Me at the zoo');
		});

		await test.step('It plays', async () => {
			await audio.expectPlaying('Me at the zoo');
		});
	});

	test('a download that fails says which item and why', async ({ dialogs, downloads, sounds }) => {
		await test.step('Make the video fail, then download it', async () => {
			downloads.failVideo('zoo', 'Video unavailable');
			await dialogs.add.download();
		});

		await test.step('The dialog says it finished with errors and why', async () => {
			await dialogs.download.expectHeading('Download finished with errors');
			await dialogs.download.expectSummary('0 added, 1 failed.');
			await dialogs.download.expectSummary('Video unavailable');
		});

		await test.step('Close it: no tile was added', async () => {
			await dialogs.download.close();
			await sounds.expectGone('Me at the zoo');
		});
	});

	test('Cancel asks first, and changing your mind lets it run', async ({ dialogs, downloads }) => {
		await test.step('Start a download that stays in progress', async () => {
			downloads.hold();
			await dialogs.add.download();
			await dialogs.download.expectButton('cancel');
		});

		await test.step('Press Cancel, then change your mind', async () => {
			await dialogs.download.cancelButChangeMind();
		});

		await test.step('The download is still running', async () => {
			await dialogs.download.expectHeading('Downloading Me at the zoo');
			await dialogs.download.expectButton('cancel');
		});
	});

	test('cancelling stops the tool and ends the download', async ({ dialogs, downloads, sounds }) => {
		await test.step('Start a download that stays in progress', async () => {
			downloads.hold();
			await dialogs.add.download();
			await dialogs.download.expectButton('cancel');
		});

		await test.step('Cancel it', async () => {
			await dialogs.download.cancel();
		});

		await test.step('The dialog says it was cancelled', async () => {
			await dialogs.download.expectHeading('Download cancelled');
			await dialogs.download.expectSummary('the rest cancelled');
			await dialogs.download.expectButton('close');
		});

		await test.step('Close it: no tile was added and the tool was killed', async () => {
			await dialogs.download.close();
			await sounds.expectGone('Me at the zoo');
			expectKilled(downloads);
		});
	});

	test('every tab shows the download, and closing it in one closes it in all', async ({ context, soundboard, dialogs, downloads }) => {
		await test.step('Start a download that stays in progress', async () => {
			downloads.hold();
			await dialogs.add.download();
			await dialogs.download.expectOpen();
		});

		const other = await context.newPage();
		const otherDialog = other.getByRole('dialog', { name: 'Download' });

		await test.step('Open a second tab: it shows the same download', async () => {
			await other.goto(soundboard.url);
			await other.locator('[data-start-mode=standalone]').click();
			await expect(otherDialog.getByRole('heading', { name: 'Downloading Me at the zoo' })).toBeVisible();
		});

		await test.step('Let it finish and close it in the first tab', async () => {
			downloads.release();
			await dialogs.download.expectSummary('1 added.');
			await dialogs.download.close();
		});

		await test.step('It closes in the second tab too', async () => {
			await expect(otherDialog).toBeHidden();
			await other.close();
		});
	});

	test('only one download runs at a time, so a second is refused', async ({ page, soundboard, dialogs, downloads }) => {
		await test.step('Start a download that stays in progress', async () => {
			downloads.hold();
			await dialogs.add.download();
			await dialogs.download.expectOpen();
		});

		const second = await test.step('Ask the server to start a second one', async () => {
			const probe = await page.request.post(`${soundboard.url}/api/download/probe`, { data: { url: ZOO } });
			const { probeId } = await probe.json();
			return page.request.post(`${soundboard.url}/api/download`, { data: { probeId, target: { kind: 'sound' } } });
		});

		await test.step('The server refuses it, and the first one finishes', async () => {
			expect(second.status()).toBe(409);
			downloads.release();
			await dialogs.download.expectSummary('1 added.');
		});
	});

	test('a reload while it runs brings the dialog and its log back', async ({ soundboard, splash, dialogs, downloads }) => {
		await test.step('Start a download that stays in progress', async () => {
			downloads.hold();
			await dialogs.add.download();
			await dialogs.download.expectLog('[download]  42.0%');
		});

		await test.step('Reload the page', async () => {
			await soundboard.reload();
			await splash.click();
			await soundboard.waitUntilLoaded();
		});

		await test.step('The dialog is back with its heading and the log so far', async () => {
			await dialogs.download.expectOpen();
			await dialogs.download.expectHeading('Downloading Me at the zoo');
			await dialogs.download.expectLog('[download]  42.0%');
		});

		await test.step('Let it finish', async () => {
			downloads.release();
			await dialogs.download.expectSummary('1 added.');
		});
	});
});

test.describe('a video split into chapters', () => {
	test('adds one sound per chosen chapter', async ({ sounds, dialogs }) => {
		await test.step('Look up the video and split it into chapters', async () => {
			await sounds.openAdd();
			await dialogs.add.lookUp(TALK);
			await dialogs.add.chooseMode('chapters');
		});

		await test.step('Leave out the middle chapter', async () => {
			await dialogs.add.choose('1', false);
		});

		await test.step('Download', async () => {
			await dialogs.add.download();
			await dialogs.download.expectSummary('2 added.');
			await dialogs.download.close();
		});

		await test.step('The other two chapters are sounds', async () => {
			await sounds.expectShown('The talk - 001 Intro', 'The talk - 003 End');
			await sounds.expectGone('The talk - 002 Middle');
		});
	});
});

test.describe('a direct link to an audio file', () => {
	test('is fetched and added by its name', async ({ sounds, dialogs, downloads }) => {
		await test.step('Look up a direct link to an audio file', async () => {
			downloads.addFile('https://files.test/fanfare.mp3', { name: 'fanfare.mp3', size: 3 });
			await sounds.openAdd();
			await dialogs.add.lookUp('https://files.test/fanfare.mp3');
		});

		await test.step('Download it', async () => {
			await dialogs.add.download();
			await dialogs.download.expectSummary('1 added.');
			await dialogs.download.close();
		});

		await test.step("A sound with the file's name is added", async () => {
			await sounds.expectShown('fanfare');
		});
	});
});

test.describe('a playlist of videos as a new playlist', () => {
	test.beforeEach(async ({ playlists, dialogs }) => {
		await test.step('Look up the playlist in the Add dialog', async () => {
			await playlists.openAdd();
			await dialogs.add.lookUp(MIX);
		});
	});

	test('creates the playlist with the chosen entries as its tracks', async ({ playlists, dialogs }) => {
		await test.step('Name the playlist and leave out one entry', async () => {
			await dialogs.add.setPlaylistTitle('Fights');
			await dialogs.add.choose('b', false);
		});

		await test.step('Download', async () => {
			await dialogs.add.download();
			await dialogs.download.expectTarget('Adding to Fights');
			await dialogs.download.expectSummary('2 added.');
			await dialogs.download.close();
		});

		await test.step('The playlist exists with two tracks', async () => {
			await playlists.expectShown('Fights');
			await playlists.expectStatus('Fights', '2 tracks');
		});
	});

	test('one entry that fails does not stop the others', async ({ playlists, dialogs, downloads }) => {
		await test.step('Make one entry fail, then download', async () => {
			downloads.failVideo('b', 'Video b is private');
			await dialogs.add.download();
		});

		await test.step('The summary counts the failure and says why', async () => {
			await dialogs.download.expectSummary('2 added, 1 failed.');
			await dialogs.download.expectSummary('Video b is private');
			await dialogs.download.close();
		});

		await test.step('The playlist has the other two tracks', async () => {
			await playlists.expectStatus('Battle music', '2 tracks');
		});
	});
});

test.describe('tracks added to an existing playlist', () => {
	test.beforeEach(async ({ playlists, dialogs }) => {
		await test.step("Open the playlist's Tracks tab, click Add and look up the video", async () => {
			await playlists.useMenu('Music MP3', 'Customize');
			await dialogs.playlistEditor.openTracksTab();
			await dialogs.playlistEditor.addTracks();
			await dialogs.add.lookUp(ZOO);
		});
	});

	test('arrive at once, and the playlist dialog comes back on the Tracks tab when the download is closed', async ({ dialogs }) => {
		await test.step('Download', async () => {
			await dialogs.add.download();
			await dialogs.download.expectTarget('Adding to Music MP3');
			await dialogs.download.expectSummary('1 added.');
		});

		await test.step('Close the download dialog', async () => {
			await dialogs.download.close();
		});

		await test.step('The playlist dialog is back on the Tracks tab with the new track first', async () => {
			await dialogs.playlistEditor.expectOpen();
			await dialogs.playlistEditor.expectTabSelected('tracks');
			await dialogs.playlistEditor.expectTracksTab('Tracks (3)');
			await dialogs.playlistEditor.expectTrackTitles(['Me at the zoo', 'Piece by Piece', 'Intro']);
		});
	});
});

test('a track added to a playlist that is playing can be reached from its bar', async ({ playlists, footer, dialogs, audio }) => {
	await test.step('Start the playlist', async () => {
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');
	});

	await test.step('Add the video to it from its Tracks tab', async () => {
		await playlists.useMenu('Music MP3', 'Customize');
		await dialogs.playlistEditor.openTracksTab();
		await dialogs.playlistEditor.addTracks();
		await dialogs.add.lookUp(ZOO);
		await dialogs.add.download();
		await dialogs.download.expectSummary('1 added.');
		await dialogs.download.close();
		await dialogs.playlistEditor.close();
	});

	const player = footer.player('Music MP3');

	await test.step("The player's track list has the new track", async () => {
		await player.openTrackList();
		await player.expectTrackList(['Me at the zoo', 'Piece by Piece', 'Intro']);
	});

	await test.step('Jump to it: it plays', async () => {
		await player.jumpTo('Me at the zoo');
		await audio.expectPlaying('Me at the zoo');
	});
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
