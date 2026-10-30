import { test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';

test.describe('the tile menus', () => {
	test.beforeEach(async ({ soundboard }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});
	});

	test('Play (Instant) starts a playlist and Stop (Instant) silences it at once', async ({ playlists, footer, audio }) => {
		await test.step('Choose Play (Instant) in the tile menu', async () => {
			await playlists.useMenu(PLAYLIST, 'Play (Instant)');
		});

		await test.step('The playlist plays', async () => {
			await audio.expectPlaying('Piece by Piece');
			await playlists.expectPlaying(PLAYLIST);
		});

		await test.step('Choose Stop (Instant)', async () => {
			await playlists.useMenu(PLAYLIST, 'Stop (Instant)');
		});

		await test.step('The footer is empty and nothing plays', async () => {
			await footer.expectEmpty();
			await audio.expectNothingPlaying();
		});
	});

	test('Next (Instant) swaps the track without keeping the old one', async ({ playlists, footer, audio }) => {
		await test.step('Start the playlist', async () => {
			await playlists.click(PLAYLIST);
			await audio.expectPlaying('Piece by Piece');
		});

		await test.step('Choose Next (Instant)', async () => {
			await playlists.useMenu(PLAYLIST, 'Next (Instant)');
		});

		await test.step('Only the second track plays', async () => {
			await footer.player(PLAYLIST).expectTrack('Intro');
			await audio.expectPlaying('Intro');
			await audio.expectNotPlaying('Piece by Piece');
			await audio.expectPlayingCount(1, { bus: 'music' });
		});
	});

	test("a sound's Stop All silences every copy of it", async ({ sounds, audio }) => {
		await test.step('Play one sound twice and another once', async () => {
			await sounds.click('Base Connected');
			await sounds.click('Base Connected');
			await sounds.click('Cluster Unlock');
			await audio.expectPlayingCount(2, { title: 'Base Connected' });
		});

		await test.step("Choose Stop All in the first sound's menu", async () => {
			await sounds.useMenu('Base Connected', 'Stop All');
		});

		await test.step('Both copies are silent and the other sound still plays', async () => {
			await sounds.expectIdle('Base Connected');
			await audio.expectNotPlaying('Base Connected');
			await audio.expectPlaying('Cluster Unlock');
		});
	});
});

test.describe('stopping a playlist that remembers its place', () => {
	test.beforeEach(async ({ soundboard, audio }) => {
		await test.step('Make the first track long', async () => {
			await soundboard.startAndWaitUntilLoaded();
			await audio.script('Piece by Piece', { duration: 100 });
		});
	});

	test('Reset forgets where a paused-when-stopped playlist was', async ({ playlists, dialogs, footer, audio }) => {
		await test.step('Set the playlist to pause when stopped', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.chooseWhenStopped('pause');
			await dialogs.playlistEditor.close();
		});

		await test.step('Play it for five seconds and stop it: it remembers its place', async () => {
			await playlists.click(PLAYLIST);
			await audio.advance(5000);
			await playlists.click(PLAYLIST);
			await playlists.expectStatus(PLAYLIST, 'Resumes at 0:05');
		});

		await test.step('Choose Reset in the tile menu', async () => {
			await playlists.useMenu(PLAYLIST, 'Reset');
		});

		await test.step('The place is forgotten: it starts from the beginning', async () => {
			await playlists.expectStatus(PLAYLIST, '2 tracks');
			await playlists.click(PLAYLIST);
			await footer.player(PLAYLIST).expectTime('0:00 / 1:40');
		});
	});

	test('"Reset track" resumes the same track from its start', async ({ playlists, dialogs, footer, audio }) => {
		await test.step('Set the playlist to reset the track when stopped', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.chooseWhenStopped('resetTrack');
			await dialogs.playlistEditor.close();
		});

		await test.step('Play it, go to the second track and let five seconds pass', async () => {
			await playlists.click(PLAYLIST);
			await footer.player(PLAYLIST).next();
			await footer.player(PLAYLIST).expectTrack('Intro');
			await audio.advance(5000);
		});

		await test.step('Stop it: the tile says it resumes the track', async () => {
			await playlists.click(PLAYLIST);
			await playlists.expectStatus(PLAYLIST, 'Resumes track 2');
		});

		await test.step('Start it again: the same track plays from its start', async () => {
			await playlists.click(PLAYLIST);
			await footer.player(PLAYLIST).expectTrack('Intro');
			await audio.expectVoice('Intro', { startAt: 0 });
		});
	});

	test('"Reset playlist" starts afresh from the first track', async ({ playlists, dialogs, footer, audio }) => {
		await test.step('Set the playlist to reset itself when stopped', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.chooseWhenStopped('resetPlaylist');
			await dialogs.playlistEditor.close();
		});

		await test.step('Play it and go to the second track', async () => {
			await playlists.click(PLAYLIST);
			await footer.player(PLAYLIST).next();
			await footer.player(PLAYLIST).expectTrack('Intro');
		});

		await test.step('Stop it: the tile shows no place to resume', async () => {
			await playlists.click(PLAYLIST);
			await playlists.expectStatus(PLAYLIST, '2 tracks');
		});

		await test.step('Start it again: the first track plays', async () => {
			await playlists.click(PLAYLIST);
			await footer.player(PLAYLIST).expectTrack('Piece by Piece');
			await audio.expectPlaying('Piece by Piece');
		});
	});
});

test.describe('the player bar', () => {
	test.beforeEach(async ({ soundboard, audio }) => {
		await test.step('Make both tracks long', async () => {
			await soundboard.startAndWaitUntilLoaded();
			await audio.script('Piece by Piece', { duration: 100 });
			await audio.script('Intro', { duration: 100 });
		});
	});

	test('Previous restarts a track that has played for a while instead of going back', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);

		await test.step('Start the playlist and go to the second track', async () => {
			await playlists.click(PLAYLIST);
			await player.next();
			await player.expectTrack('Intro');
		});

		await test.step('Let ten seconds pass', async () => {
			await audio.advance(10_000);
			await player.expectTime('0:10 / 1:40');
		});

		await test.step('Press Previous', async () => {
			await player.previous();
		});

		await test.step('The same track starts over', async () => {
			await player.expectTrack('Intro');
			await player.expectTime('0:00 / 1:40');
		});
	});

	test('Previous within the first seconds goes back to the track before', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);

		await test.step('Start the playlist and go to the second track', async () => {
			await playlists.click(PLAYLIST);
			await player.next();
			await player.expectTrack('Intro');
		});

		await test.step('Let a second pass and press Previous', async () => {
			await audio.advance(1000);
			await player.previous();
		});

		await test.step('The first track plays again', async () => {
			await player.expectTrack('Piece by Piece');
		});
	});

	test('repeating the track plays it again when it ends', async ({ playlists, dialogs, footer, audio }) => {
		await test.step('Make the first track 30 s long and set the playlist to repeat the track', async () => {
			await audio.script('Piece by Piece', { duration: 30 });
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.setRepeatTrack(true);
			await dialogs.playlistEditor.close();
		});

		await test.step('Start the playlist', async () => {
			await playlists.click(PLAYLIST);
			await audio.expectPlaying('Piece by Piece');
		});

		await test.step('Let the track play to its end', async () => {
			await audio.advance(30_000);
		});

		await test.step('The same track plays again', async () => {
			await footer.player(PLAYLIST).expectTrack('Piece by Piece');
			await audio.expectPlaying('Piece by Piece');
			await audio.expectNotPlaying('Intro');
		});
	});

	test('the last track leads back to the first while the playlist repeats', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);

		await test.step('Start the playlist and go to the last track', async () => {
			await playlists.click(PLAYLIST);
			await player.next();
			await player.expectTrack('Intro');
		});

		await test.step('Press Next', async () => {
			await player.next();
		});

		await test.step('The first track plays again', async () => {
			await player.expectTrack('Piece by Piece');
			await audio.expectPlaying('Piece by Piece');
		});
	});

	test('seeking while paused moves the time without any sound', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);

		await test.step('Start the playlist and pause it', async () => {
			await playlists.click(PLAYLIST);
			await player.pause();
			await player.expectPaused();
		});

		await test.step('Seek to a quarter of the track: the time jumps and stays there', async () => {
			await player.seekTo(0.25);
			await player.expectTime('0:25 / 1:40');
			await audio.advance(5000);
			await player.expectTime('0:25 / 1:40');
		});

		await test.step('Resume: the time carries on from there', async () => {
			await player.resume();
			await audio.advance(1000);
			await player.expectTime('0:26 / 1:40');
		});
	});

	test('times from an hour on show hours', async ({ playlists, footer, audio }) => {
		await test.step('Make the first track just over an hour long and start the playlist', async () => {
			await audio.script('Piece by Piece', { duration: 3725 });
			await playlists.click(PLAYLIST);
		});

		await test.step('Let an hour, a minute and a second pass', async () => {
			await audio.advance(3_661_000);
		});

		await test.step('The times show hours', async () => {
			await footer.player(PLAYLIST).expectTime('1:01:01 / 1:02:05');
		});
	});

	test('the duration shows as dashes while the track is loading', async ({ playlists, footer, audio }) => {
		await test.step('Make the first track take five seconds to load, then start the playlist', async () => {
			await audio.script('Piece by Piece', { duration: 100, loadDelay: 5 });
			await playlists.click(PLAYLIST);
		});

		await test.step('The time shows dashes', async () => {
			await footer.player(PLAYLIST).expectTime('--:--');
		});

		await test.step('Let the track finish loading', async () => {
			await audio.advance(5000);
		});

		await test.step('The duration shows', async () => {
			await footer.player(PLAYLIST).expectTime('/ 1:40');
		});
	});
});
