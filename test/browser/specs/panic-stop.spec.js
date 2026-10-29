import { test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';
const SOUND = 'Base Connected';

/** Gives the playlist and the sound a 2 s fade-out, then starts both. */
test.describe('with fade-outs', () => {
	test.beforeEach(async ({ soundboard, playlists, sounds, dialogs, audio }) => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.script('Piece by Piece', { duration: 100 });
		await audio.script(SOUND, { duration: 60 });
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.setFadeOut('2');
		await dialogs.playlistEditor.close();
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.setFadeOut('2');
		await dialogs.soundEditor.close();
		await playlists.click(PLAYLIST);
		await sounds.click(SOUND);
		await audio.expectPlaying('Piece by Piece');
		await audio.expectPlaying(SOUND);
	});

	test('the first press fades everything and the button offers to cut it', async ({ footer, audio, playlists, sounds }) => {
		await footer.expectPanic('fade');

		await footer.pressPanic();

		await footer.expectPanic('now');
		await playlists.expectStatus(PLAYLIST, '2 tracks');
		await audio.expectPlaying('Piece by Piece');
		await audio.expectPlaying(SOUND);
		await sounds.expectPlaying(SOUND);
	});

	test('the second press stops everything at once', async ({ footer, audio, sounds }) => {
		await footer.pressPanic();
		await footer.pressPanic();

		await audio.expectNothingPlaying();
		await footer.expectPanic('fade');
		await footer.expectEmpty();
		await sounds.expectIdle(SOUND);
	});

	test('the button goes back by itself once the fades are over', async ({ footer, audio }) => {
		await footer.pressPanic();
		await audio.advance(3500);

		await footer.expectPanic('fade');
		await audio.expectNothingPlaying();
	});

	test('starting something while it fades brings the first state back', async ({ footer, playlists, audio }) => {
		await footer.pressPanic();
		await footer.expectPanic('now');

		await playlists.click('Music Ogg');
		await audio.advance(200);

		await footer.expectPanic('fade');
	});
});

test('without fade-outs one press stops everything and the button stays as it is', async ({ soundboard, playlists, sounds, footer, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await playlists.click(PLAYLIST);
	await sounds.click(SOUND);
	await audio.expectPlaying(SOUND);

	await footer.pressPanic();

	await audio.expectNothingPlaying();
	await footer.expectPanic('fade');
	await footer.expectEmpty();
});

test('pressing it with nothing playing changes nothing', async ({ soundboard, footer }) => {
	await soundboard.startAndWaitUntilLoaded();

	await footer.pressPanic();

	await footer.expectPanic('fade');
	await footer.expectEmpty();
});
