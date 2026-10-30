import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../../helpers/tmp-tree.js';
import { test } from '../support/fixtures.js';

test.describe('moving a sound', () => {
	test.beforeEach(async ({ soundboard, sounds }) => {
		await soundboard.startAndWaitUntilLoaded();
		await sounds.useMenu('Base Connected', 'Customize');
	});

	test('the dialog lists the sound effects first, then every playlist, and marks where the sound is', async ({ dialogs }) => {
		await dialogs.soundEditor.openMove();

		await dialogs.move.expectOpen();
		await dialogs.move.expectDestinations(['Sound effects', 'Music Mix', 'Music MP3', 'Music Ogg', 'Music Order']);
		await dialogs.move.expectHere('Sound effects');
	});

	test('picking a playlist turns the sound into its last track and closes both dialogs', async ({ sounds, playlists, dialogs }) => {
		await playlists.expectStatus('Music MP3', '2 tracks');
		await dialogs.soundEditor.openMove();

		await dialogs.move.moveTo('Music MP3');

		await dialogs.move.expectClosed();
		await dialogs.soundEditor.expectClosed();
		await sounds.expectGone('Base Connected');
		await playlists.expectStatus('Music MP3', '3 tracks');
	});

	test('the moved sound is a track of the playlist now', async ({ playlists, dialogs, footer, audio }) => {
		await dialogs.soundEditor.openMove();
		await dialogs.move.moveTo('Music MP3');
		await dialogs.move.expectClosed();

		await playlists.useMenu('Music MP3', 'Customize');
		await dialogs.playlistEditor.openTracksTab();

		await dialogs.playlistEditor.expectTrackTitles(['Piece by Piece', 'Intro', 'Base Connected']);
		await dialogs.playlistEditor.track('Base Connected').play();
		await audio.expectPlaying('Base Connected');
		await footer.player('Music MP3').expectTrack('Base Connected');
	});

	test('a failed move shows the reason and leaves the choices open', async ({ page, sounds, dialogs }) => {
		await page.route('**/api/move', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the folder is read-only' }) }));
		await dialogs.soundEditor.openMove();

		await dialogs.move.moveTo('Music MP3');

		await dialogs.move.expectError('the folder is read-only');
		await dialogs.move.expectOpen();
		await sounds.expectShown('Base Connected');
	});

	test('Esc closes the move dialog and leaves the sound dialog open', async ({ page, dialogs }) => {
		await dialogs.soundEditor.openMove();

		await page.keyboard.press('Escape');

		await dialogs.move.expectClosed();
		await dialogs.soundEditor.expectOpen();
	});
});

test.describe('moving where a file of the same name is', () => {
	const audio = readFileSync(join(FIXTURES_DIR, 'example_soundboard', 'Sound MP3 no title tag.mp3'));
	test.use({ library: { 'Boom.mp3': audio, 'Rain': { 'Boom.mp3': audio, 'Drip.mp3': audio } } });

	test.beforeEach(async ({ soundboard }) => {
		await soundboard.startAndWaitUntilLoaded();
	});

	test('a sound keeps the file already there and gets a " (2)" in its name', async ({ sounds, playlists, dialogs, disk }) => {
		await sounds.useMenu('Boom.mp3', 'Customize');
		await dialogs.soundEditor.openMove();

		await dialogs.move.moveTo('Rain');

		await sounds.expectGone('Boom.mp3');
		await playlists.expectStatus('Rain', '3 tracks');
		await disk.expectFile('Rain/Boom (2).mp3');
		await disk.expectFile('Rain/Boom.mp3');
	});

	test('a track moved to the sound effects gets a " (2)" in its name', async ({ playlists, sounds, dialogs, disk }) => {
		await playlists.useMenu('Rain', 'Customize');
		await dialogs.playlistEditor.openTracksTab();
		const track = dialogs.playlistEditor.track('Boom.mp3');
		await track.open();

		await track.openMove();
		await dialogs.move.moveTo('Sound effects');

		await dialogs.move.expectClosed();
		await playlists.expectStatus('Rain', '1 track');
		// The track keeps its title, so the sound effects now hold two sounds called Boom.mp3.
		await sounds.expectCount('Boom.mp3', 2);
		await disk.expectFile('Boom (2).mp3');
		await disk.expectFile('Boom.mp3');
	});
});
