import { test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test('Customize opens the playlist dialog with the title ready to type', async ({ playlists, dialogs }) => {
	await playlists.useMenu(PLAYLIST, 'Customize');

	await dialogs.playlistEditor.expectOpen();
	await dialogs.playlistEditor.expectTitleFocused();
	await dialogs.playlistEditor.expectTitle(PLAYLIST);
});

test('a new title shows on the tile and the player bar at once', async ({ playlists, footer, dialogs }) => {
	await playlists.click(PLAYLIST);
	await footer.expectPlayersCount(1);
	await playlists.useMenu(PLAYLIST, 'Customize');

	await dialogs.playlistEditor.setTitle('Tavern songs');

	await playlists.expectShown('Tavern songs');
	await footer.player('Tavern songs').expectTrack('Piece by Piece');
});

test('order, repeat, when stopped and crossfade are saved', async ({ playlists, dialogs, audio, disk }) => {
	await playlists.useMenu(PLAYLIST, 'Customize');

	await dialogs.playlistEditor.chooseOrder('shuffle');
	await dialogs.playlistEditor.setRepeatTrack(true);
	await dialogs.playlistEditor.chooseWhenStopped('resetTrack');
	await dialogs.playlistEditor.setCrossfade('2.5');

	await dialogs.playlistEditor.expectCrossfade('2.500 s');
	await audio.advance(500);
	await disk.expectOptions(PLAYLIST, { order: 'shuffle', trackLooping: true, stopMode: 'resetTrack', crossfade: 2.5 });
	await dialogs.playlistEditor.expectSaved();
});

test('the settings are what the dialog shows after a reload', async ({ soundboard, splash, playlists, dialogs, audio }) => {
	await playlists.useMenu(PLAYLIST, 'Customize');
	await dialogs.playlistEditor.chooseOrder('random');
	await dialogs.playlistEditor.setVolume('-3');
	await audio.advance(500);
	await dialogs.playlistEditor.expectSaved();

	await soundboard.reload();
	await splash.click();
	await soundboard.waitUntilLoaded();
	await playlists.useMenu(PLAYLIST, 'Customize');

	await dialogs.playlistEditor.expectOrder('random');
	await dialogs.playlistEditor.expectVolume('-3.0 dB');
});

test('the Tracks tab counts the tracks', async ({ playlists, dialogs }) => {
	await playlists.useMenu(PLAYLIST, 'Customize');

	await dialogs.playlistEditor.expectTracksTab('Tracks (2)');
	await dialogs.playlistEditor.openTracksTab();
	await dialogs.playlistEditor.expectTrackCount(2);
});

test('Play in the dialog starts the playlist and the footer shows it', async ({ playlists, dialogs, footer, audio }) => {
	await playlists.useMenu(PLAYLIST, 'Customize');

	await dialogs.playlistEditor.play();

	await dialogs.playlistEditor.expectPlaying();
	await footer.expectPlayersCount(1);
	await audio.expectPlaying('Piece by Piece');
});

test('a playlist set to pause when stopped remembers where it was', async ({ playlists, dialogs, footer, audio }) => {
	await playlists.useMenu(PLAYLIST, 'Customize');
	await dialogs.playlistEditor.chooseWhenStopped('pause');
	await dialogs.playlistEditor.close();
	await playlists.click(PLAYLIST);
	await audio.advance(5000);
	await footer.player(PLAYLIST).expectTime('0:05');

	await playlists.click(PLAYLIST);

	await playlists.expectStatus(PLAYLIST, 'Resumes at 0:05');
});
