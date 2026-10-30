import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../../helpers/tmp-tree.js';
import { test } from '../support/fixtures.js';

test.describe('moving a sound', () => {
	test.beforeEach(async ({ soundboard, sounds }) => {
		await test.step("Open the sound's dialog", async () => {
			await soundboard.startAndWaitUntilLoaded();
			await sounds.useMenu('Base Connected', 'Customize');
		});
	});

	test('the dialog lists the sound effects first, then every playlist, and marks where the sound is', async ({ dialogs }) => {
		await test.step('Open the Move dialog', async () => {
			await dialogs.soundEditor.openMove();
		});

		await test.step('It lists every destination and marks the current one', async () => {
			await dialogs.move.expectOpen();
			await dialogs.move.expectDestinations(['Sound effects', 'Music Mix', 'Music MP3', 'Music Ogg', 'Music Order']);
			await dialogs.move.expectHere('Sound effects');
		});
	});

	test('picking a playlist turns the sound into its last track and closes both dialogs', async ({ sounds, playlists, dialogs }) => {
		await test.step('Open the Move dialog; the playlist has two tracks', async () => {
			await playlists.expectStatus('Music MP3', '2 tracks');
			await dialogs.soundEditor.openMove();
		});

		await test.step('Pick the playlist', async () => {
			await dialogs.move.moveTo('Music MP3');
		});

		await test.step('Both dialogs close, the sound is gone and the playlist has three tracks', async () => {
			await dialogs.move.expectClosed();
			await dialogs.soundEditor.expectClosed();
			await sounds.expectGone('Base Connected');
			await playlists.expectStatus('Music MP3', '3 tracks');
		});
	});

	test('the moved sound is a track of the playlist now', async ({ playlists, dialogs, footer, audio }) => {
		await test.step('Move the sound into the playlist', async () => {
			await dialogs.soundEditor.openMove();
			await dialogs.move.moveTo('Music MP3');
			await dialogs.move.expectClosed();
		});

		await test.step("Open the playlist's Tracks tab: the sound is the last track", async () => {
			await playlists.useMenu('Music MP3', 'Customize');
			await dialogs.playlistEditor.openTracksTab();
			await dialogs.playlistEditor.expectTrackTitles(['Piece by Piece', 'Intro', 'Base Connected']);
		});

		await test.step('Play it as a track', async () => {
			await dialogs.playlistEditor.track('Base Connected').play();
			await audio.expectPlaying('Base Connected');
			await footer.player('Music MP3').expectTrack('Base Connected');
		});
	});

	test('a failed move shows the reason and leaves the choices open', async ({ page, sounds, dialogs }) => {
		await test.step('Make the server refuse moves', async () => {
			await page.route('**/api/move', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the folder is read-only' }) }));
		});

		await test.step('Try to move the sound', async () => {
			await dialogs.soundEditor.openMove();
			await dialogs.move.moveTo('Music MP3');
		});

		await test.step('The dialog shows the reason and stays open, and the sound is where it was', async () => {
			await dialogs.move.expectError('the folder is read-only');
			await dialogs.move.expectOpen();
			await sounds.expectShown('Base Connected');
		});
	});

	test('Esc closes the move dialog and leaves the sound dialog open', async ({ page, dialogs }) => {
		await test.step('Open the Move dialog and press Esc', async () => {
			await dialogs.soundEditor.openMove();
			await page.keyboard.press('Escape');
		});

		await test.step('Only the Move dialog closes', async () => {
			await dialogs.move.expectClosed();
			await dialogs.soundEditor.expectOpen();
		});
	});
});

test.describe('moving where a file of the same name is', () => {
	const audio = readFileSync(join(FIXTURES_DIR, 'example_soundboard', 'Sound MP3 no title tag.mp3'));
	test.use({ library: { 'Boom.mp3': audio, 'Rain': { 'Boom.mp3': audio, 'Drip.mp3': audio } } });

	test.beforeEach(async ({ soundboard }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});
	});

	test('a sound keeps the file already there and gets a " (2)" in its name', async ({ sounds, playlists, dialogs, disk }) => {
		await test.step('Open the Move dialog of the sound', async () => {
			await sounds.useMenu('Boom.mp3', 'Customize');
			await dialogs.soundEditor.openMove();
		});

		await test.step('Move it to the playlist that has a Boom.mp3', async () => {
			await dialogs.move.moveTo('Rain');
		});

		await test.step('It is a track there, and both files are on disk', async () => {
			await sounds.expectGone('Boom.mp3');
			await playlists.expectStatus('Rain', '3 tracks');
			await disk.expectFile('Rain/Boom (2).mp3');
			await disk.expectFile('Rain/Boom.mp3');
		});
	});

	test('a track moved to the sound effects gets a " (2)" in its name', async ({ playlists, sounds, dialogs, disk }) => {
		const track = dialogs.playlistEditor.track('Boom.mp3');

		await test.step("Open the track in the playlist's Tracks tab", async () => {
			await playlists.useMenu('Rain', 'Customize');
			await dialogs.playlistEditor.openTracksTab();
			await track.open();
		});

		await test.step('Move it to the sound effects', async () => {
			await track.openMove();
			await dialogs.move.moveTo('Sound effects');
			await dialogs.move.expectClosed();
		});

		await test.step('The playlist has one track left, and both files are on disk', async () => {
			await playlists.expectStatus('Rain', '1 track');
			// The track keeps its title, so the sound effects now hold two sounds called Boom.mp3.
			await sounds.expectCount('Boom.mp3', 2);
			await disk.expectFile('Boom (2).mp3');
			await disk.expectFile('Boom.mp3');
		});
	});
});
