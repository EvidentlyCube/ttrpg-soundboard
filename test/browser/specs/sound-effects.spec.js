import { test } from '../support/fixtures.js';

test('a sound plays when its tile is pressed and shows a stop button', async ({ soundboard, sounds, audio }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('Click the sound', async () => {
		await sounds.click('Base Connected');
	});

	await test.step('It plays and its tile shows the stop button', async () => {
		await audio.expectPlaying('Base Connected');
		await sounds.expectPlaying('Base Connected');
	});
});

test('sounds overlap, and the same sound can play over itself', async ({ soundboard, sounds, audio }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('Click one sound twice and another once', async () => {
		await sounds.click('Base Connected');
		await sounds.click('Base Connected');
		await sounds.click('Cluster Unlock');
	});

	await test.step('Three voices play, two of them the same sound', async () => {
		await audio.expectPlayingCount(2, { title: 'Base Connected' });
		await audio.expectPlayingCount(3, { bus: 'sfx' });
	});
});

test('the stop button silences every copy of that sound and no other', async ({ soundboard, sounds, audio }) => {
	await test.step('Play one sound twice and another once', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await sounds.click('Base Connected');
		await sounds.click('Base Connected');
		await sounds.click('Cluster Unlock');
	});

	await test.step('Stop the first sound', async () => {
		await sounds.stop('Base Connected');
	});

	await test.step('Both copies are silent and the other sound still plays', async () => {
		await sounds.expectIdle('Base Connected');
		await audio.expectNotPlaying('Base Connected');
		await audio.expectPlaying('Cluster Unlock');
		await sounds.expectPlaying('Cluster Unlock');
	});
});

test('a sound becomes idle by itself when it ends', async ({ soundboard, sounds, audio }) => {
	await test.step('Make the sound 1.5 s long and play it', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.givenFile('Base Connected', { duration: 1.5 });
		await sounds.click('Base Connected');
		await sounds.expectPlaying('Base Connected');
	});

	await test.step('Let it play to its end', async () => {
		await audio.advance(1500);
	});

	await test.step('The tile is idle and nothing plays', async () => {
		await sounds.expectIdle('Base Connected');
		await audio.expectNothingPlaying();
	});
});

test('sounds never get a player bar', async ({ soundboard, sounds, footer }) => {
	await test.step('Play a sound', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await sounds.click('Base Connected');
		await sounds.expectPlaying('Base Connected');
	});

	await test.step('The footer stays empty', async () => {
		await footer.expectEmpty();
	});
});
