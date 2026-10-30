import { expect, test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard, playlists, audio }) => {
	await test.step('Make the track long, then start the playlist', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.script('Piece by Piece', { duration: 100 });
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');
	});
});

test("the player bar's live volume changes what plays, and the tile shows an orange icon while it is turned down", async ({ playlists, footer, audio }) => {
	await test.step('At full volume the tile has no level icon', async () => {
		await playlists.expectLevelIcon('Music MP3', false);
	});

	await test.step('Turn the live volume down to half on the player bar', async () => {
		await footer.player('Music MP3').setLevel(0.5);
	});

	await test.step('The voice is quieter and the tile shows the icon', async () => {
		await audio.expectVoice('Piece by Piece', { gain: expect.closeTo(0.25, 1) });
		await playlists.expectLevelIcon('Music MP3', true);
	});
});

test("double-clicking the bar or the tile's icon brings the volume back to full", async ({ playlists, footer, audio }) => {
	await test.step('Turn the volume down', async () => {
		await footer.player('Music MP3').setLevel(0.3);
		await playlists.expectLevelIcon('Music MP3', true);
	});

	await test.step('Reset it from the player bar', async () => {
		await footer.player('Music MP3').resetLevel();
		await audio.expectVoice('Piece by Piece', { gain: 1 });
		await playlists.expectLevelIcon('Music MP3', false);
	});

	await test.step('Turn it down again and reset it from the tile', async () => {
		await footer.player('Music MP3').setLevel(0.3);
		await playlists.resetLevel('Music MP3');
	});

	await test.step('The voice is at full volume and still playing', async () => {
		await audio.expectVoice('Piece by Piece', { gain: 1 });
		await playlists.expectPlaying('Music MP3');
	});
});

test('the level stays after a stop and is gone after a reload', async ({ soundboard, splash, playlists, footer, audio }) => {
	await test.step('Turn the volume down and stop the playlist', async () => {
		await footer.player('Music MP3').setLevel(0.3);
		await footer.player('Music MP3').stop();
		await playlists.expectIdle('Music MP3');
		await playlists.expectLevelIcon('Music MP3', true);
	});

	await test.step('Start it again: it plays at the lowered level', async () => {
		await playlists.click('Music MP3');
		await audio.expectVoice('Piece by Piece', { gain: expect.closeTo(0.09, 1) });
	});

	await test.step('Reload the page: the level is gone', async () => {
		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();
		await playlists.expectLevelIcon('Music MP3', false);
	});
});
