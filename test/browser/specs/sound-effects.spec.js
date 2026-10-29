import { test } from '../support/fixtures.js';

test('a sound plays when its tile is pressed and shows a stop button', async ({ soundboard, sounds, audio }) => {
	await soundboard.startAndWaitUntilLoaded();

	await sounds.click('Base Connected');

	await audio.expectPlaying('Base Connected');
	await sounds.expectPlaying('Base Connected');
});

test('sounds overlap, and the same sound can play over itself', async ({ soundboard, sounds, audio }) => {
	await soundboard.startAndWaitUntilLoaded();

	await sounds.click('Base Connected');
	await sounds.click('Base Connected');
	await sounds.click('Cluster Unlock');

	await audio.expectPlayingCount(2, { title: 'Base Connected' });
	await audio.expectPlayingCount(3, { bus: 'sfx' });
});

test('the stop button silences every copy of that sound and no other', async ({ soundboard, sounds, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await sounds.click('Base Connected');
	await sounds.click('Base Connected');
	await sounds.click('Cluster Unlock');

	await sounds.stop('Base Connected');

	await sounds.expectIdle('Base Connected');
	await audio.expectNotPlaying('Base Connected');
	await audio.expectPlaying('Cluster Unlock');
	await sounds.expectPlaying('Cluster Unlock');
});

test('a sound becomes idle by itself when it ends', async ({ soundboard, sounds, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.script('Base Connected', { duration: 1.5 });
	await sounds.click('Base Connected');
	await sounds.expectPlaying('Base Connected');

	await audio.advance(1500);

	await sounds.expectIdle('Base Connected');
	await audio.expectNothingPlaying();
});

test('sounds never get a player bar', async ({ soundboard, sounds, footer }) => {
	await soundboard.startAndWaitUntilLoaded();

	await sounds.click('Base Connected');
	await sounds.expectPlaying('Base Connected');

	await footer.expectEmpty();
});
