import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard, playlists, audio }) => {
	await test.step('Make the first track long, then start the playlist', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.script('Piece by Piece', { duration: 100 });
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');
	});
});

test('pausing freezes the time and resuming carries on from there', async ({ playlists, footer, audio }) => {
	const player = footer.player('Music MP3');

	await test.step('Let two seconds pass', async () => {
		await audio.advance(2000);
		await player.expectTime('0:02 / 1:40');
	});

	await test.step('Pause and let five more seconds pass', async () => {
		await player.pause();
		await audio.advance(5000);
	});

	await test.step('The time stands still and the tile says Paused', async () => {
		await player.expectPaused();
		await playlists.expectStatus('Music MP3', 'Paused');
		await player.expectTime('0:02 / 1:40');
	});

	await test.step('Resume and let a second pass', async () => {
		await player.resume();
		await audio.advance(1000);
	});

	await test.step('The time carries on from where it stopped', async () => {
		await player.expectNotPaused();
		await playlists.expectStatus('Music MP3', 'Playing');
		await player.expectTime('0:03 / 1:40');
	});
});

test('next goes to the following track', async ({ footer, audio }) => {
	await test.step('Press next', async () => {
		await footer.player('Music MP3').next();
	});

	await test.step('The second track plays instead of the first', async () => {
		await footer.player('Music MP3').expectTrack('Intro');
		await audio.expectPlaying('Intro');
		await audio.expectNotPlaying('Piece by Piece');
	});
});

test('previous goes back to the track before', async ({ footer, audio }) => {
	const player = footer.player('Music MP3');

	await test.step('Go to the second track', async () => {
		await player.next();
		await player.expectTrack('Intro');
	});

	await test.step('Press previous', async () => {
		await player.previous();
	});

	await test.step('The first track plays again', async () => {
		await player.expectTrack('Piece by Piece');
		await audio.expectPlaying('Piece by Piece');
	});
});

test('stop removes the bar and silences the playlist', async ({ playlists, footer, audio }) => {
	await test.step('Press stop', async () => {
		await footer.player('Music MP3').stop();
	});

	await test.step('The bar is gone, nothing plays and the tile is idle', async () => {
		await footer.expectEmpty();
		await audio.expectNothingPlaying();
		await playlists.expectIdle('Music MP3');
	});
});

test('clicking the progress bar seeks to that point', async ({ footer, audio }) => {
	const player = footer.player('Music MP3');

	await test.step('Click the middle of the progress bar', async () => {
		await player.seekTo(0.5);
	});

	await test.step('The time jumps to the middle', async () => {
		await player.expectTime('0:50 / 1:40');
	});

	await test.step('It carries on from there', async () => {
		await audio.advance(1000);
		await player.expectTime('0:51 / 1:40');
	});
});

test('the track list shows every track, marks the current one and jumps to a pick', async ({ footer, audio }) => {
	const player = footer.player('Music MP3');

	await test.step('Open the track list: it shows every track and marks the current one', async () => {
		await player.openTrackList();
		await player.expectTrackList(['Piece by Piece', 'Intro']);
		await player.expectCurrentInTrackList('Piece by Piece');
	});

	await test.step('Pick the other track', async () => {
		await player.jumpTo('Intro');
	});

	await test.step('It plays', async () => {
		await player.expectTrack('Intro');
		await audio.expectPlaying('Intro');
	});
});

test('the tile menu stops and skips a playlist too', async ({ playlists, footer, audio }) => {
	await test.step('Choose Next in the tile menu', async () => {
		await playlists.useMenu('Music MP3', 'Next');
		await footer.player('Music MP3').expectTrack('Intro');
	});

	await test.step('Choose Stop in the tile menu', async () => {
		await playlists.useMenu('Music MP3', 'Stop');
	});

	await test.step('The bar is gone and nothing plays', async () => {
		await footer.expectEmpty();
		await audio.expectNothingPlaying();
	});
});
