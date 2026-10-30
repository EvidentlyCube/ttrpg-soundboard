import { test } from '../support/fixtures.js';

test('a sound that cannot be loaded flashes its tile red and plays nothing', async ({ soundboard, sounds, audio }) => {
	await test.step('Make the sound fail to decode', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.givenFile('Base Connected', { bufferError: 'Could not decode' });
	});

	await test.step('Click the sound', async () => {
		await sounds.click('Base Connected');
	});

	await test.step('The tile flashes red, then goes back to idle', async () => {
		await sounds.expectError('Base Connected');
		await audio.expectNothingPlaying();
		await sounds.expectIdle('Base Connected');
		await sounds.expectNoError('Base Connected');
	});
});

test('a playlist whose tracks all fail gives up and flashes its tile red', async ({ soundboard, playlists, footer, audio }) => {
	await test.step('Make every track of the playlist fail to load', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.givenFile('Piece by Piece', { loadError: 'Could not load' });
		await audio.givenFile('Intro', { loadError: 'Could not load' });
	});

	await test.step('Click the playlist', async () => {
		await playlists.click('Music MP3');
	});

	await test.step('The tile flashes red, then goes back to idle, and no player appears', async () => {
		await playlists.expectError('Music MP3');
		await playlists.expectIdle('Music MP3');
		await footer.expectEmpty();
		await playlists.expectNoError('Music MP3');
	});
});

test.describe('in a browser that cannot play Ogg', () => {
	test.use({ unplayableFormats: ['ogg'] });

	test('Ogg tiles are disabled and say why, MP3 ones are not', async ({ soundboard, sounds, playlists }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});

		await test.step('The Ogg sound and playlist are disabled with a reason', async () => {
			await sounds.expectDisabled('Cluster Unlock', 'cannot play OGG');
			await playlists.expectDisabled('Music Ogg', 'cannot play any of its tracks');
		});

		await test.step('An MP3 sound still plays', async () => {
			await sounds.click('Base Connected');
			await sounds.expectPlaying('Base Connected');
		});
	});
});

test('when the system takes the audio away, the splash asks for a click and the playlist carries on after it', async ({ soundboard, splash, playlists, footer, audio }) => {
	await test.step('Play a playlist', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');
	});

	await test.step('The system suspends the audio: the splash asks for a click', async () => {
		await audio.suspend();
		await splash.expectVisible('Audio paused by the system. Click to resume.');
	});

	await test.step('Click the splash and let the audio resume', async () => {
		await splash.click();
		await audio.resume();
	});

	await test.step('The splash goes and the playlist carries on', async () => {
		await splash.expectHidden();
		await footer.player('Music MP3').expectTrack('Piece by Piece');
		await audio.expectPlaying('Piece by Piece');
	});
});
