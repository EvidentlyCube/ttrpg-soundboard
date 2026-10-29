import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard, playlists, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.script('Piece by Piece', { duration: 100 });
	await playlists.click('Music MP3');
	await audio.expectPlaying('Piece by Piece');
});

test('pausing freezes the time and resuming carries on from there', async ({ playlists, footer, audio }) => {
	const player = footer.player('Music MP3');
	await audio.advance(2000);
	await player.expectTime('0:02 / 1:40');

	await player.pause();
	await audio.advance(5000);

	await player.expectPaused();
	await playlists.expectStatus('Music MP3', 'Paused');
	await player.expectTime('0:02 / 1:40');

	await player.resume();
	await audio.advance(1000);

	await player.expectNotPaused();
	await playlists.expectStatus('Music MP3', 'Playing');
	await player.expectTime('0:03 / 1:40');
});

test('next goes to the following track', async ({ footer, audio }) => {
	await footer.player('Music MP3').next();

	await footer.player('Music MP3').expectTrack('Intro');
	await audio.expectPlaying('Intro');
	await audio.expectNotPlaying('Piece by Piece');
});

test('previous goes back to the track before', async ({ footer, audio }) => {
	const player = footer.player('Music MP3');
	await player.next();
	await player.expectTrack('Intro');

	await player.previous();

	await player.expectTrack('Piece by Piece');
	await audio.expectPlaying('Piece by Piece');
});

test('stop removes the bar and silences the playlist', async ({ playlists, footer, audio }) => {
	await footer.player('Music MP3').stop();

	await footer.expectEmpty();
	await audio.expectNothingPlaying();
	await playlists.expectIdle('Music MP3');
});

test('clicking the progress bar seeks to that point', async ({ footer, audio }) => {
	const player = footer.player('Music MP3');

	await player.seekTo(0.5);

	await player.expectTime('0:50 / 1:40');
	await audio.advance(1000);
	await player.expectTime('0:51 / 1:40');
});

test('the track list shows every track, marks the current one and jumps to a pick', async ({ footer, audio }) => {
	const player = footer.player('Music MP3');

	await player.openTrackList();
	await player.expectTrackList(['Piece by Piece', 'Intro']);
	await player.expectCurrentInTrackList('Piece by Piece');
	await player.jumpTo('Intro');

	await player.expectTrack('Intro');
	await audio.expectPlaying('Intro');
});

test('the tile menu stops and skips a playlist too', async ({ playlists, footer, audio }) => {
	await playlists.useMenu('Music MP3', 'Next');
	await footer.player('Music MP3').expectTrack('Intro');

	await playlists.useMenu('Music MP3', 'Stop');

	await footer.expectEmpty();
	await audio.expectNothingPlaying();
});
