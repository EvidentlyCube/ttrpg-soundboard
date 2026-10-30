import { test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';

test.describe('the tile menus', () => {
	test.beforeEach(async ({ soundboard }) => {
		await soundboard.startAndWaitUntilLoaded();
	});

	test('Play (Instant) starts a playlist and Stop (Instant) silences it at once', async ({ playlists, footer, audio }) => {
		await playlists.useMenu(PLAYLIST, 'Play (Instant)');

		await audio.expectPlaying('Piece by Piece');
		await playlists.expectPlaying(PLAYLIST);

		await playlists.useMenu(PLAYLIST, 'Stop (Instant)');

		await footer.expectEmpty();
		await audio.expectNothingPlaying();
	});

	test('Next (Instant) swaps the track without keeping the old one', async ({ playlists, footer, audio }) => {
		await playlists.click(PLAYLIST);
		await audio.expectPlaying('Piece by Piece');

		await playlists.useMenu(PLAYLIST, 'Next (Instant)');

		await footer.player(PLAYLIST).expectTrack('Intro');
		await audio.expectPlaying('Intro');
		await audio.expectNotPlaying('Piece by Piece');
		await audio.expectPlayingCount(1, { bus: 'music' });
	});

	test("a sound's Stop All silences every copy of it", async ({ sounds, audio }) => {
		await sounds.click('Base Connected');
		await sounds.click('Base Connected');
		await sounds.click('Cluster Unlock');
		await audio.expectPlayingCount(2, { title: 'Base Connected' });

		await sounds.useMenu('Base Connected', 'Stop All');

		await sounds.expectIdle('Base Connected');
		await audio.expectNotPlaying('Base Connected');
		await audio.expectPlaying('Cluster Unlock');
	});
});

test.describe('stopping a playlist that remembers its place', () => {
	test.beforeEach(async ({ soundboard, audio }) => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.script('Piece by Piece', { duration: 100 });
	});

	test('Reset forgets where a paused-when-stopped playlist was', async ({ playlists, dialogs, footer, audio }) => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.chooseWhenStopped('pause');
		await dialogs.playlistEditor.close();
		await playlists.click(PLAYLIST);
		await audio.advance(5000);
		await playlists.click(PLAYLIST);
		await playlists.expectStatus(PLAYLIST, 'Resumes at 0:05');

		await playlists.useMenu(PLAYLIST, 'Reset');

		await playlists.expectStatus(PLAYLIST, '2 tracks');
		await playlists.click(PLAYLIST);
		await footer.player(PLAYLIST).expectTime('0:00 / 1:40');
	});

	test('"Reset track" resumes the same track from its start', async ({ playlists, dialogs, footer, audio }) => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.chooseWhenStopped('resetTrack');
		await dialogs.playlistEditor.close();
		await playlists.click(PLAYLIST);
		await footer.player(PLAYLIST).next();
		await footer.player(PLAYLIST).expectTrack('Intro');
		await audio.advance(5000);

		await playlists.click(PLAYLIST);

		await playlists.expectStatus(PLAYLIST, 'Resumes track 2');
		await playlists.click(PLAYLIST);
		await footer.player(PLAYLIST).expectTrack('Intro');
		await audio.expectVoice('Intro', { startAt: 0 });
	});

	test('"Reset playlist" starts afresh from the first track', async ({ playlists, dialogs, footer, audio }) => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.chooseWhenStopped('resetPlaylist');
		await dialogs.playlistEditor.close();
		await playlists.click(PLAYLIST);
		await footer.player(PLAYLIST).next();
		await footer.player(PLAYLIST).expectTrack('Intro');

		await playlists.click(PLAYLIST);
		await playlists.expectStatus(PLAYLIST, '2 tracks');
		await playlists.click(PLAYLIST);

		await footer.player(PLAYLIST).expectTrack('Piece by Piece');
		await audio.expectPlaying('Piece by Piece');
	});
});

test.describe('the player bar', () => {
	test.beforeEach(async ({ soundboard, audio }) => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.script('Piece by Piece', { duration: 100 });
		await audio.script('Intro', { duration: 100 });
	});

	test('Previous restarts a track that has played for a while instead of going back', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);
		await playlists.click(PLAYLIST);
		await player.next();
		await player.expectTrack('Intro');
		await audio.advance(10_000);
		await player.expectTime('0:10 / 1:40');

		await player.previous();

		await player.expectTrack('Intro');
		await player.expectTime('0:00 / 1:40');
	});

	test('Previous within the first seconds goes back to the track before', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);
		await playlists.click(PLAYLIST);
		await player.next();
		await player.expectTrack('Intro');
		await audio.advance(1000);

		await player.previous();

		await player.expectTrack('Piece by Piece');
	});

	test('repeating the track plays it again when it ends', async ({ playlists, dialogs, footer, audio }) => {
		await audio.script('Piece by Piece', { duration: 30 });
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.setRepeatTrack(true);
		await dialogs.playlistEditor.close();
		await playlists.click(PLAYLIST);
		await audio.expectPlaying('Piece by Piece');

		await audio.advance(30_000);

		await footer.player(PLAYLIST).expectTrack('Piece by Piece');
		await audio.expectPlaying('Piece by Piece');
		await audio.expectNotPlaying('Intro');
	});

	test('the last track leads back to the first while the playlist repeats', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);
		await playlists.click(PLAYLIST);
		await player.next();
		await player.expectTrack('Intro');

		await player.next();

		await player.expectTrack('Piece by Piece');
		await audio.expectPlaying('Piece by Piece');
	});

	test('seeking while paused moves the time without any sound', async ({ playlists, footer, audio }) => {
		const player = footer.player(PLAYLIST);
		await playlists.click(PLAYLIST);
		await player.pause();
		await player.expectPaused();

		await player.seekTo(0.25);

		await player.expectTime('0:25 / 1:40');
		await audio.advance(5000);
		await player.expectTime('0:25 / 1:40');

		await player.resume();
		await audio.advance(1000);
		await player.expectTime('0:26 / 1:40');
	});

	test('times from an hour on show hours', async ({ playlists, footer, audio }) => {
		await audio.script('Piece by Piece', { duration: 3725 });
		await playlists.click(PLAYLIST);

		await audio.advance(3_661_000);

		await footer.player(PLAYLIST).expectTime('1:01:01 / 1:02:05');
	});

	test('the duration shows as dashes while the track is loading', async ({ playlists, footer, audio }) => {
		await audio.script('Piece by Piece', { duration: 100, loadDelay: 5 });
		await playlists.click(PLAYLIST);

		await footer.player(PLAYLIST).expectTime('--:--');

		await audio.advance(5000);

		await footer.player(PLAYLIST).expectTime('/ 1:40');
	});
});
