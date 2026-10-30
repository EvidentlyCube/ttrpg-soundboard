import { test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('Customize opens the playlist dialog with the title ready to type', async ({ playlists, dialogs }) => {
	await test.step('Choose Customize in the playlist menu', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
	});

	await test.step('The dialog is open with the title focused', async () => {
		await dialogs.playlistEditor.expectOpen();
		await dialogs.playlistEditor.expectTitleFocused();
		await dialogs.playlistEditor.expectTitle(PLAYLIST);
	});
});

test('a new title shows on the tile and the player bar at once', async ({ playlists, footer, dialogs }) => {
	await test.step('Start the playlist and open its dialog', async () => {
		await playlists.click(PLAYLIST);
		await footer.expectPlayersCount(1);
		await playlists.useMenu(PLAYLIST, 'Customize');
	});

	await test.step('Type a new title', async () => {
		await dialogs.playlistEditor.setTitle('Tavern songs');
	});

	await test.step('The tile and the player bar show it', async () => {
		await playlists.expectShown('Tavern songs');
		await footer.player('Tavern songs').expectTrack('Piece by Piece');
	});
});

test('order, repeat, when stopped and crossfade are saved', async ({ playlists, dialogs, audio, disk }) => {
	await test.step('Open the dialog', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
	});

	await test.step('Change the order, repeat, when stopped and crossfade', async () => {
		await dialogs.playlistEditor.chooseOrder('shuffle');
		await dialogs.playlistEditor.setRepeatTrack(true);
		await dialogs.playlistEditor.chooseWhenStopped('resetTrack');
		await dialogs.playlistEditor.setCrossfade('2.5');
	});

	await test.step('The crossfade shows its value', async () => {
		await dialogs.playlistEditor.expectCrossfade('2.500 s');
	});

	await test.step('Half a second later everything is on disk', async () => {
		await audio.advance(500);
		await disk.expectOptions(PLAYLIST, { order: 'shuffle', trackLooping: true, stopMode: 'resetTrack', crossfade: 2.5 });
		await dialogs.playlistEditor.expectSaved();
	});
});

test('turning off repeating the playlist is saved', async ({ playlists, dialogs, audio, disk }) => {
	await test.step('Open the dialog', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
	});

	await test.step('Turn off repeating the playlist', async () => {
		await dialogs.playlistEditor.setRepeatPlaylist(false);
	});

	await test.step('Half a second later it is on disk', async () => {
		await audio.advance(500);
		await disk.expectOptions(PLAYLIST, { playlistLooping: false });
		await dialogs.playlistEditor.expectSaved();
	});
});

test('the settings are what the dialog shows after a reload', async ({ soundboard, splash, playlists, dialogs, audio }) => {
	await test.step('Change the order and volume and let them save', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.chooseOrder('random');
		await dialogs.playlistEditor.setVolume('-3');
		await audio.advance(500);
		await dialogs.playlistEditor.expectSaved();
	});

	await test.step('Reload the page and open the dialog again', async () => {
		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();
		await playlists.useMenu(PLAYLIST, 'Customize');
	});

	await test.step('The dialog shows the saved settings', async () => {
		await dialogs.playlistEditor.expectOrder('random');
		await dialogs.playlistEditor.expectVolume('-3.0 dB');
	});
});

test('the Tracks tab counts the tracks', async ({ playlists, dialogs }) => {
	await test.step('Open the dialog', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
	});

	await test.step('The tab label has the count', async () => {
		await dialogs.playlistEditor.expectTracksTab('Tracks (2)');
	});

	await test.step('The tab lists that many tracks', async () => {
		await dialogs.playlistEditor.openTracksTab();
		await dialogs.playlistEditor.expectTrackCount(2);
	});
});

test('Play in the dialog starts the playlist and the footer shows it', async ({ playlists, dialogs, footer, audio }) => {
	await test.step('Open the dialog', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
	});

	await test.step('Click Play', async () => {
		await dialogs.playlistEditor.play();
	});

	await test.step('The dialog, the footer and the engine all show it playing', async () => {
		await dialogs.playlistEditor.expectPlaying();
		await footer.expectPlayersCount(1);
		await audio.expectPlaying('Piece by Piece');
	});
});

test('a playlist set to pause when stopped remembers where it was', async ({ playlists, dialogs, footer, audio }) => {
	await test.step('Set the playlist to pause when stopped', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.chooseWhenStopped('pause');
		await dialogs.playlistEditor.close();
	});

	await test.step('Play it for five seconds', async () => {
		await playlists.click(PLAYLIST);
		await audio.advance(5000);
		await footer.player(PLAYLIST).expectTime('0:05');
	});

	await test.step('Click the tile to stop it', async () => {
		await playlists.click(PLAYLIST);
	});

	await test.step('The tile says where it resumes', async () => {
		await playlists.expectStatus(PLAYLIST, 'Resumes at 0:05');
	});
});
