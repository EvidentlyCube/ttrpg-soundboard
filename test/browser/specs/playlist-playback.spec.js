import { test } from '../support/fixtures.js';

test('a playlist starts from its tile and keeps time in the footer', async ({ soundboard, splash, playlists, footer, audio }) => {
	await test.step('Open the page and click through the splash', async () => {
		await soundboard.open();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('Click the playlist: it plays and has a player in the footer', async () => {
		await playlists.click('Music MP3');
		await footer.expectPlayersCount(1);
		await audio.expectPlaying('Piece by Piece');
		await playlists.expectPlaying('Music MP3');
	});

	await test.step('A second later the footer shows the time', async () => {
		await audio.advance(1000);
		await footer.player('Music MP3').expectTime('0:01 / 3:00');
	});
});

test('the footer says so while nothing plays', async ({ soundboard, footer }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('The footer is empty', async () => {
		await footer.expectEmpty();
	});
});

test('a playlist stops when its tile is pressed again', async ({ soundboard, playlists, footer, audio }) => {
	await test.step('Start the playlist', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');
	});

	await test.step('Click the tile again', async () => {
		await playlists.click('Music MP3');
	});

	await test.step('The footer is empty, nothing plays and the tile is idle', async () => {
		await footer.expectEmpty();
		await audio.expectNothingPlaying();
		await playlists.expectIdle('Music MP3');
	});
});

test('two playlists play side by side', async ({ soundboard, playlists, footer, audio }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('Start two playlists', async () => {
		await playlists.click('Music MP3');
		await playlists.click('Music Order');
	});

	await test.step('Both have a player and both sound', async () => {
		await footer.expectPlayersCount(2);
		await audio.expectPlayingCount(2, { bus: 'music' });
	});
});

test('the next track starts when the first one ends', async ({ soundboard, playlists, footer, audio }) => {
	await test.step('Make the first track 30 s long and start the playlist', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.script('Piece by Piece', { duration: 30 });
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');
	});

	await test.step('Let the track play to its end', async () => {
		await audio.advance(30_000);
	});

	await test.step('The second track plays instead', async () => {
		await footer.player('Music MP3').expectTrack('Intro');
		await audio.expectPlaying('Intro');
		await audio.expectNotPlaying('Piece by Piece');
	});
});
