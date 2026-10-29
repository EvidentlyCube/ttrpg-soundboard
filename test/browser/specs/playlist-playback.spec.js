import { test } from '../support/fixtures.js';

test('a playlist starts from its tile and keeps time in the footer', async ({ soundboard, splash, playlists, footer, audio }) => {
	await soundboard.open();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await playlists.click('Music MP3');
	await footer.expectPlayersCount(1);
	await audio.expectPlaying('Piece by Piece');
	await playlists.expectPlaying('Music MP3');

	await audio.advance(1000);
	await footer.player('Music MP3').expectTime('0:01 / 3:00');
});

test('the footer says so while nothing plays', async ({ soundboard, footer }) => {
	await soundboard.startAndWaitUntilLoaded();

	await footer.expectEmpty();
});

test('a playlist stops when its tile is pressed again', async ({ soundboard, playlists, footer, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await playlists.click('Music MP3');
	await audio.expectPlaying('Piece by Piece');

	await playlists.click('Music MP3');

	await footer.expectEmpty();
	await audio.expectNothingPlaying();
	await playlists.expectIdle('Music MP3');
});

test('two playlists play side by side', async ({ soundboard, playlists, footer, audio }) => {
	await soundboard.startAndWaitUntilLoaded();

	await playlists.click('Music MP3');
	await playlists.click('Music Order');

	await footer.expectPlayersCount(2);
	await audio.expectPlayingCount(2, { bus: 'music' });
});

test('the next track starts when the first one ends', async ({ soundboard, playlists, footer, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.script('Piece by Piece', { duration: 30 });
	await playlists.click('Music MP3');
	await audio.expectPlaying('Piece by Piece');

	await audio.advance(30_000);

	await footer.player('Music MP3').expectTrack('Intro');
	await audio.expectPlaying('Intro');
	await audio.expectNotPlaying('Piece by Piece');
});
