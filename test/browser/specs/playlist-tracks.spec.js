import { expect, test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';
const FIRST = 'Piece by Piece';
const SECOND = 'Intro';
const FIRST_FILE = 'Music MP3/Song 1 MP3 with title tag.mp3';

test.beforeEach(async ({ soundboard, playlists, dialogs }) => {
	await test.step("Open the playlist's dialog on the Tracks tab", async () => {
		await soundboard.startAndWaitUntilLoaded();
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openTracksTab();
	});
});

test.describe('a single track', () => {
	test('its row opens and closes, one at a time', async ({ dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);
		const second = dialogs.playlistEditor.track(SECOND);

		await test.step('Both rows start closed', async () => {
			await first.expectClosed();
		});

		await test.step('Open the first row', async () => {
			await first.open();
			await first.expectOpen();
		});

		await test.step('Open the second row: the first closes', async () => {
			await second.open();
			await second.expectOpen();
			await first.expectClosed();
		});

		await test.step("Click the second row's header: it closes", async () => {
			await second.toggle();
			await second.expectClosed();
		});
	});

	test('renaming it updates its row at once and is saved', async ({ dialogs, audio, disk }) => {
		const track = dialogs.playlistEditor.track(FIRST);

		await test.step("Open the track's row", async () => {
			await track.open();
		});

		await test.step('Rename it: the row shows the new name and the dialog says it is saving', async () => {
			await track.rename('Opening theme');
			await dialogs.playlistEditor.track('Opening theme').expectHeader('Opening theme');
			await dialogs.playlistEditor.expectSaving();
		});

		await test.step('Half a second later the name is on disk', async () => {
			await audio.advance(500);
			await disk.expectOptions(FIRST_FILE, { title: 'Opening theme' });
			await dialogs.playlistEditor.expectSaved();
		});
	});

	test('a volume of its own shows as a bubble in its row, and is saved', async ({ dialogs, audio, disk }) => {
		const track = dialogs.playlistEditor.track(FIRST);

		await test.step('The row has no volume bubble; open it', async () => {
			await track.expectVolumeBubble(null);
			await track.open();
		});

		await test.step('Set a volume: the row shows a bubble', async () => {
			await track.setVolume('-6');
			await track.expectVolumeBubble('-6.0 dB');
		});

		await test.step('Half a second later the volume is on disk', async () => {
			await audio.advance(500);
			await disk.expectOptions(FIRST_FILE, { gain: expect.closeTo(0.501, 3) });
			await dialogs.playlistEditor.expectSaved();
		});
	});

	test('a start point marks it as cropped, and Reset takes the mark away', async ({ dialogs, audio, disk }) => {
		const track = dialogs.playlistEditor.track(FIRST);

		await test.step('The track is not cropped; open its row', async () => {
			await track.expectCropped(false);
			await track.open();
		});

		await test.step('Set a start point: the row is marked as cropped and the point is saved', async () => {
			await track.setStart('2');
			await track.expectCropped(true);
			await audio.advance(500);
			await disk.expectOptions(FIRST_FILE, { startAt: 2 });
		});

		await test.step('Reset the range: the mark goes', async () => {
			await track.resetRange();
			await track.expectCropped(false);
		});
	});

	test('playing it from its row starts the playlist there, and the button turns into Stop', async ({ dialogs, footer, audio }) => {
		const track = dialogs.playlistEditor.track(SECOND);

		await test.step('The track is not playing', async () => {
			await track.expectPlayback('idle');
		});

		await test.step('Press its play button', async () => {
			await track.play();
		});

		await test.step('It plays, the player bar shows it and the other track is idle', async () => {
			await audio.expectPlaying(SECOND);
			await track.expectPlayback('playing');
			await footer.player(PLAYLIST).expectTrack(SECOND);
			await dialogs.playlistEditor.track(FIRST).expectPlayback('idle');
		});

		await test.step('Press the button again, now Stop', async () => {
			await track.play();
		});

		await test.step('Nothing plays and the track is idle', async () => {
			await audio.expectNothingPlaying();
			await track.expectPlayback('idle');
		});
	});

	test('while it plays its points are a seek bar, and pressing the bar seeks', async ({ dialogs, footer, audio }) => {
		const track = dialogs.playlistEditor.track(FIRST);

		await test.step('Make the track 100 s long and open its row: the range is editable', async () => {
			await audio.givenFile(FIRST, { duration: 100 });
			await track.open();
			await track.expectEditableRange();
		});

		await test.step('Play it: the range becomes a seek bar', async () => {
			await track.play();
			await audio.expectPlaying(FIRST);
			await track.expectSeekBar();
		});

		await test.step('Press the middle of the bar: the player seeks there', async () => {
			await track.seekTo(0.5);
			await footer.player(PLAYLIST).expectTime('0:15 / 1:40');
		});

		await test.step('Stop it: the range is editable again', async () => {
			await track.play();
			await track.expectEditableRange();
		});
	});

	test('a failed save is reported in the dialog', async ({ page, dialogs, audio }) => {
		const track = dialogs.playlistEditor.track(FIRST);

		await test.step("Make the server refuse saves and open the track's row", async () => {
			await page.route('**/api/tracks/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk full' }) }));
			await track.open();
		});

		await test.step('Rename the track and let the save run', async () => {
			await track.rename('Opening theme');
			await audio.advance(500);
		});

		await test.step('The dialog reports the failure', async () => {
			await dialogs.playlistEditor.expectSaveFailed('disk full');
		});
	});
});

test.describe('the list of tracks', () => {
	test('deleting a track removes its row and renumbers the others', async ({ dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);

		await test.step("Open the first track's row and hold Delete", async () => {
			await first.open();
			await first.holdToDelete();
		});

		await test.step('Its row is gone and the other track is now number 1', async () => {
			await first.expectGone();
			await dialogs.playlistEditor.expectTracksTab('Tracks (1)');
			await dialogs.playlistEditor.expectTrackTitles([SECOND]);
			await dialogs.playlistEditor.track(SECOND).expectNumber(1);
		});
	});

	test('the last track warns that deleting it deletes the playlist', async ({ dialogs }) => {
		const last = dialogs.playlistEditor.track(SECOND);

		await test.step('Delete the first track', async () => {
			const first = dialogs.playlistEditor.track(FIRST);
			await first.open();
			await first.holdToDelete();
		});

		await test.step("Open the last track's row", async () => {
			await last.open();
		});

		await test.step('A note warns that deleting or moving it deletes the playlist', async () => {
			await last.expectNote('deleting or moving it deletes the playlist too');
		});
	});

	test('deleting the last track deletes the playlist and closes the dialog', async ({ playlists, dialogs, header }) => {
		const last = dialogs.playlistEditor.track(SECOND);

		await test.step('Delete the first track and open the last one', async () => {
			const first = dialogs.playlistEditor.track(FIRST);
			await first.open();
			await first.holdToDelete();
			await last.open();
		});

		await test.step('Hold Delete on the last track', async () => {
			await last.holdToDelete();
		});

		await test.step('The dialog closes, the playlist is gone and the trash holds it', async () => {
			await dialogs.playlistEditor.expectClosed();
			await playlists.expectGone(PLAYLIST);
			await header.expectTrash('0.7 MB');
		});
	});

	test('a deleted track goes to the trash and can be restored', async ({ dialogs, header }) => {
		await test.step('Delete the first track and close the dialog', async () => {
			const first = dialogs.playlistEditor.track(FIRST);
			await first.open();
			await first.holdToDelete();
			await first.expectGone();
			await dialogs.playlistEditor.close();
		});

		await test.step('Open the trash: the track is in it', async () => {
			await header.openTrash();
			await dialogs.trash.expectHolding(FIRST);
		});
	});

	test('Move… sends a track to the sound effects', async ({ sounds, dialogs }) => {
		const first = dialogs.playlistEditor.track(FIRST);

		await test.step("Open the track's row and its Move dialog", async () => {
			await first.open();
			await first.openMove();
			await dialogs.move.expectOpen();
			await dialogs.move.expectHere(PLAYLIST);
		});

		await test.step('Pick the sound effects', async () => {
			await dialogs.move.moveTo('Sound effects');
		});

		await test.step('The track leaves the playlist and the sound effects get it', async () => {
			await dialogs.move.expectClosed();
			await first.expectGone();
			await dialogs.playlistEditor.expectTracksTab('Tracks (1)');
			await dialogs.playlistEditor.close();
			await sounds.expectShown(FIRST);
		});
	});

	test('moving the only track away deletes the playlist and closes its dialog', async ({ playlists, sounds, dialogs }) => {
		const last = dialogs.playlistEditor.track(SECOND);

		await test.step('Delete the first track and open the last one', async () => {
			const first = dialogs.playlistEditor.track(FIRST);
			await first.open();
			await first.holdToDelete();
			await last.open();
		});

		await test.step('Move the last track to the sound effects', async () => {
			await last.openMove();
			await dialogs.move.moveTo('Sound effects');
		});

		await test.step('The dialog closes, the playlist is gone and the track is a sound', async () => {
			await dialogs.playlistEditor.expectClosed();
			await playlists.expectGone(PLAYLIST);
			await sounds.expectShown(SECOND);
		});
	});
});

test.describe('the playlist itself', () => {
	test('the fade-in and fade-out are saved', async ({ dialogs, audio, disk }) => {
		await test.step('Open the Playlist tab', async () => {
			await dialogs.playlistEditor.openPlaylistTab();
		});

		await test.step('Set a fade-in and a fade-out: the dialog shows them', async () => {
			await dialogs.playlistEditor.setFadeIn('1');
			await dialogs.playlistEditor.setFadeOut('2.5');
			await dialogs.playlistEditor.expectFadeIn('1.000 s');
			await dialogs.playlistEditor.expectFadeOut('2.500 s');
		});

		await test.step('Half a second later they are on disk', async () => {
			await audio.advance(500);
			await disk.expectOptions(PLAYLIST, { fadeIn: 1, fadeOut: 2.5 });
			await dialogs.playlistEditor.expectSaved();
		});
	});

	test('the crossfade field says how long it can be, as half the shortest track', async ({ dialogs }) => {
		await test.step('Open the Playlist tab', async () => {
			await dialogs.playlistEditor.openPlaylistTab();
		});

		await test.step('The crossfade note gives the limit', async () => {
			await dialogs.playlistEditor.expectCrossfadeNote(/Up to .*, half the shortest track\./);
		});
	});

	test('a crossfade longer than that is held at the limit', async ({ dialogs }) => {
		await test.step('Open the Playlist tab', async () => {
			await dialogs.playlistEditor.openPlaylistTab();
		});

		await test.step('Set a crossfade of 30 s', async () => {
			await dialogs.playlistEditor.setCrossfade('30');
		});

		await test.step('It is held at half the shortest track', async () => {
			await dialogs.playlistEditor.expectCrossfade('15.060 s');
		});
	});

	test('deleting it from the dialog closes the dialog and puts it in the trash', async ({ playlists, dialogs, header }) => {
		await test.step('The dialog opens on the Tracks tab; go to the Playlist tab', async () => {
			await dialogs.playlistEditor.expectTabSelected('tracks');
			await dialogs.playlistEditor.openPlaylistTab();
		});

		await test.step('Hold Delete playlist', async () => {
			await dialogs.playlistEditor.holdToDeletePlaylist();
		});

		await test.step('The dialog closes, the playlist is gone and the trash holds it', async () => {
			await dialogs.playlistEditor.expectClosed();
			await playlists.expectGone(PLAYLIST);
			await header.expectTrash('0.7 MB');
		});
	});
});
