import { test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';
const SOUND = 'Base Connected';

/** Gives the playlist and the sound a 2 s fade-out, then starts both. */
test.describe('with fade-outs', () => {
	test.beforeEach(async ({ soundboard, playlists, sounds, dialogs, audio }) => {
		await test.step('Make the files long enough to still be playing after the fades', async () => {
			await soundboard.startAndWaitUntilLoaded();
			await audio.script('Piece by Piece', { duration: 100 });
			await audio.script(SOUND, { duration: 60 });
		});

		await test.step('Give the playlist a 2 s fade-out', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.setFadeOut('2');
			await dialogs.playlistEditor.close();
		});

		await test.step('Give the sound a 2 s fade-out', async () => {
			await sounds.useMenu(SOUND, 'Customize');
			await dialogs.soundEditor.setFadeOut('2');
			await dialogs.soundEditor.close();
		});

		await test.step('Start the playlist and the sound', async () => {
			await playlists.click(PLAYLIST);
			await sounds.click(SOUND);
			await audio.expectPlaying('Piece by Piece');
			await audio.expectPlaying(SOUND);
		});
	});

	test('the first press fades everything and the button offers to cut it', async ({ footer, audio, playlists, sounds }) => {
		await test.step('The button offers to fade', async () => {
			await footer.expectPanic('fade');
		});

		await test.step('Press it', async () => {
			await footer.pressPanic();
		});

		await test.step('The button now offers to cut, and both are still sounding while they fade', async () => {
			await footer.expectPanic('now');
			await playlists.expectStatus(PLAYLIST, '2 tracks');
			await audio.expectPlaying('Piece by Piece');
			await audio.expectPlaying(SOUND);
			await sounds.expectPlaying(SOUND);
		});
	});

	test('the second press stops everything at once', async ({ footer, audio, sounds }) => {
		await test.step('Press it twice', async () => {
			await footer.pressPanic();
			await footer.pressPanic();
		});

		await test.step('Everything is silent without waiting for the fades', async () => {
			await audio.expectNothingPlaying();
			await footer.expectPanic('fade');
			await footer.expectEmpty();
			await sounds.expectIdle(SOUND);
		});
	});

	test('the button goes back by itself once the fades are over', async ({ footer, audio }) => {
		await test.step('Press it', async () => {
			await footer.pressPanic();
		});

		await test.step('Let the fades run out', async () => {
			await audio.advance(3500);
		});

		await test.step('The button offers to fade again and nothing plays', async () => {
			await footer.expectPanic('fade');
			await audio.expectNothingPlaying();
		});
	});

	test('starting something while it fades brings the first state back', async ({ footer, playlists, audio }) => {
		await test.step('Press it, so the button offers to cut', async () => {
			await footer.pressPanic();
			await footer.expectPanic('now');
		});

		await test.step('Start another playlist', async () => {
			await playlists.click('Music Ogg');
			await audio.advance(200);
		});

		await test.step('The button offers to fade again', async () => {
			await footer.expectPanic('fade');
		});
	});
});

test('without fade-outs one press stops everything and the button stays as it is', async ({ soundboard, playlists, sounds, footer, audio }) => {
	await test.step('Start a playlist and a sound that have no fade-out', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await playlists.click(PLAYLIST);
		await sounds.click(SOUND);
		await audio.expectPlaying(SOUND);
	});

	await test.step('Press it', async () => {
		await footer.pressPanic();
	});

	await test.step('Everything is silent and the button never offered to cut', async () => {
		await audio.expectNothingPlaying();
		await footer.expectPanic('fade');
		await footer.expectEmpty();
	});
});

test('pressing it with nothing playing changes nothing', async ({ soundboard, footer }) => {
	await test.step('Start with nothing playing', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('Press it', async () => {
		await footer.pressPanic();
	});

	await test.step('The button and the footer are as they were', async () => {
		await footer.expectPanic('fade');
		await footer.expectEmpty();
	});
});
