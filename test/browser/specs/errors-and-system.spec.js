import { test } from '../support/fixtures.js';

test('a sound that cannot be loaded flashes its tile red and plays nothing', async ({ soundboard, sounds, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.script('Base Connected', { bufferError: 'Could not decode' });

	await sounds.click('Base Connected');

	await sounds.expectError('Base Connected');
	await audio.expectNothingPlaying();
	await sounds.expectIdle('Base Connected');
	await sounds.expectNoError('Base Connected');
});

test('a playlist whose tracks all fail gives up and flashes its tile red', async ({ soundboard, playlists, footer, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.script('Piece by Piece', { loadError: 'Could not load' });
	await audio.script('Intro', { loadError: 'Could not load' });

	await playlists.click('Music MP3');

	await playlists.expectError('Music MP3');
	await playlists.expectIdle('Music MP3');
	await footer.expectEmpty();
	await playlists.expectNoError('Music MP3');
});

test.describe('in a browser that cannot play Ogg', () => {
	test.use({ unplayableFormats: ['ogg'] });

	test('Ogg tiles are disabled and say why, MP3 ones are not', async ({ soundboard, sounds, playlists }) => {
		await soundboard.startAndWaitUntilLoaded();

		await sounds.expectDisabled('Cluster Unlock', 'cannot play OGG');
		await playlists.expectDisabled('Music Ogg', 'cannot play any of its tracks');
		await sounds.click('Base Connected');
		await sounds.expectPlaying('Base Connected');
	});
});

test('when the system takes the audio away, the splash asks for a click and the playlist carries on after it', async ({ soundboard, splash, playlists, footer, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await playlists.click('Music MP3');
	await audio.expectPlaying('Piece by Piece');

	await audio.suspend();
	await splash.expectVisible('Audio paused by the system. Click to resume.');
	await splash.click();
	await audio.resume();

	await splash.expectHidden();
	await footer.player('Music MP3').expectTrack('Piece by Piece');
	await audio.expectPlaying('Piece by Piece');
});
