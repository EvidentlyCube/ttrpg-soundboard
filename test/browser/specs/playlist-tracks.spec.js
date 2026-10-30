import { expect, test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';
const FIRST = 'Piece by Piece';
const SECOND = 'Intro';
const FIRST_FILE = 'Music MP3/Song 1 MP3 with title tag.mp3';

test.beforeEach(async ({ soundboard, playlists, dialogs }) => {
	await soundboard.startAndWaitUntilLoaded();
	await playlists.useMenu(PLAYLIST, 'Customize');
	await dialogs.playlistEditor.openTracksTab();
});

test.describe('a single track', () => {
	test('its row opens and closes, one at a time', async ({ dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		const second = dialogs.playlistEditor.track(SECOND);
		await first.expectClosed();

		await first.open();
		await first.expectOpen();

		await second.open();
		await second.expectOpen();
		await first.expectClosed();

		await second.toggle();
		await second.expectClosed();
	});

	test('renaming it updates its row at once and is saved', async ({ dialogs, audio, disk }) => {
		const track = dialogs.playlistEditor.track(FIRST);
		await track.open();

		await track.rename('Opening theme');

		await dialogs.playlistEditor.track('Opening theme').expectHeader('Opening theme');
		await dialogs.playlistEditor.expectSaving();
		await audio.advance(500);
		await disk.expectOptions(FIRST_FILE, { title: 'Opening theme' });
		await dialogs.playlistEditor.expectSaved();
	});

	test('a volume of its own shows as a bubble in its row, and is saved', async ({ dialogs, audio, disk }) => {
		const track = dialogs.playlistEditor.track(FIRST);
		await track.expectVolumeBubble(null);
		await track.open();

		await track.setVolume('-6');

		await track.expectVolumeBubble('-6.0 dB');
		await audio.advance(500);
		await disk.expectOptions(FIRST_FILE, { gain: expect.closeTo(0.501, 3) });
		await dialogs.playlistEditor.expectSaved();
	});

	test('a start point marks it as cropped, and Reset takes the mark away', async ({ dialogs, audio, disk }) => {
		const track = dialogs.playlistEditor.track(FIRST);
		await track.expectCropped(false);
		await track.open();

		await track.setStart('2');

		await track.expectCropped(true);
		await audio.advance(500);
		await disk.expectOptions(FIRST_FILE, { startAt: 2 });

		await track.resetRange();

		await track.expectCropped(false);
	});

	test('playing it from its row starts the playlist there, and the button turns into Stop', async ({ dialogs, footer, audio }) => {
		const track = dialogs.playlistEditor.track(SECOND);
		await track.expectPlayback('idle');

		await track.play();

		await audio.expectPlaying(SECOND);
		await track.expectPlayback('playing');
		await footer.player(PLAYLIST).expectTrack(SECOND);
		await dialogs.playlistEditor.track(FIRST).expectPlayback('idle');

		await track.play();

		await audio.expectNothingPlaying();
		await track.expectPlayback('idle');
	});

	test('while it plays its points are a seek bar, and pressing the bar seeks', async ({ dialogs, footer, audio }) => {
		await audio.script(FIRST, { duration: 100 });
		const track = dialogs.playlistEditor.track(FIRST);
		await track.open();
		await track.expectEditableRange();

		await track.play();
		await audio.expectPlaying(FIRST);

		await track.expectSeekBar();
		await track.seekTo(0.5);
		await footer.player(PLAYLIST).expectTime('0:15 / 1:40');

		await track.play();
		await track.expectEditableRange();
	});

	test('a failed save is reported in the dialog', async ({ page, dialogs, audio }) => {
		await page.route('**/api/tracks/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk full' }) }));
		const track = dialogs.playlistEditor.track(FIRST);
		await track.open();

		await track.rename('Opening theme');
		await audio.advance(500);

		await dialogs.playlistEditor.expectSaveFailed('disk full');
	});
});

test.describe('the list of tracks', () => {
	test('deleting a track removes its row and renumbers the others', async ({ dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		await first.open();

		await first.holdToDelete();

		await first.expectGone();
		await dialogs.playlistEditor.expectTracksTab('Tracks (1)');
		await dialogs.playlistEditor.expectTrackTitles([SECOND]);
		await dialogs.playlistEditor.track(SECOND).expectNumber(1);
	});

	test('the last track warns that deleting it deletes the playlist', async ({ dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		await first.open();
		await first.holdToDelete();
		const last = dialogs.playlistEditor.track(SECOND);

		await last.open();

		await last.expectNote('deleting or moving it deletes the playlist too');
	});

	test('deleting the last track deletes the playlist and closes the dialog', async ({ playlists, dialogs, header }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		await first.open();
		await first.holdToDelete();
		const last = dialogs.playlistEditor.track(SECOND);
		await last.open();

		await last.holdToDelete();

		await dialogs.playlistEditor.expectClosed();
		await playlists.expectGone(PLAYLIST);
		await header.expectTrash('0.7 MB');
	});

	test('a deleted track goes to the trash and can be restored', async ({ dialogs, header }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		await first.open();
		await first.holdToDelete();
		await first.expectGone();
		await dialogs.playlistEditor.close();

		await header.openTrash();
		await dialogs.trash.expectHolding(FIRST);
	});

	test('Move… sends a track to the sound effects', async ({ sounds, dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		await first.open();

		await first.openMove();
		await dialogs.move.expectOpen();
		await dialogs.move.expectHere(PLAYLIST);
		await dialogs.move.moveTo('Sound effects');

		await dialogs.move.expectClosed();
		await first.expectGone();
		await dialogs.playlistEditor.expectTracksTab('Tracks (1)');
		await dialogs.playlistEditor.close();
		await sounds.expectShown(FIRST);
	});

	test('moving the only track away deletes the playlist and closes its dialog', async ({ playlists, sounds, dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		await first.open();
		await first.holdToDelete();
		const last = dialogs.playlistEditor.track(SECOND);
		await last.open();

		await last.openMove();
		await dialogs.move.moveTo('Sound effects');

		await dialogs.playlistEditor.expectClosed();
		await playlists.expectGone(PLAYLIST);
		await sounds.expectShown(SECOND);
	});
});

test.describe('the playlist itself', () => {
	test('the fade-in and fade-out are saved', async ({ dialogs, audio, disk }) => {
		await dialogs.playlistEditor.openPlaylistTab();

		await dialogs.playlistEditor.setFadeIn('1');
		await dialogs.playlistEditor.setFadeOut('2.5');

		await dialogs.playlistEditor.expectFadeIn('1.000 s');
		await dialogs.playlistEditor.expectFadeOut('2.500 s');
		await audio.advance(500);
		await disk.expectOptions(PLAYLIST, { fadeIn: 1, fadeOut: 2.5 });
		await dialogs.playlistEditor.expectSaved();
	});

	test('the crossfade field says how long it can be, as half the shortest track', async ({ dialogs }) => {
		await dialogs.playlistEditor.openPlaylistTab();

		await dialogs.playlistEditor.expectCrossfadeNote(/Up to .*, half the shortest track\./);
	});

	test('a crossfade longer than that is held at the limit', async ({ dialogs }) => {
		await dialogs.playlistEditor.openPlaylistTab();

		await dialogs.playlistEditor.setCrossfade('30');

		await dialogs.playlistEditor.expectCrossfade('15.060 s');
	});

	test('deleting it from the dialog closes the dialog and puts it in the trash', async ({ playlists, dialogs, header }) => {
		await dialogs.playlistEditor.expectTabSelected('tracks');
		await dialogs.playlistEditor.openPlaylistTab();

		await dialogs.playlistEditor.holdToDeletePlaylist();

		await dialogs.playlistEditor.expectClosed();
		await playlists.expectGone(PLAYLIST);
		await header.expectTrash('0.7 MB');
	});
});
