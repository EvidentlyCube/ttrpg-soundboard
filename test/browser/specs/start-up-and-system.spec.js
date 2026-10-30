import { test } from '../support/fixtures.js';

test('when the library cannot be loaded the splash says so and a click tries again', async ({ page, soundboard, splash }) => {
	await soundboard.open();
	await page.route('**/api/library', (route) => route.abort());

	await splash.click();

	await splash.expectVisible('Could not start the soundboard. Click to retry.');

	await page.unroute('**/api/library');
	await splash.click();

	await soundboard.waitUntilLoaded();
});

test.describe('an empty folder', () => {
	test.use({ library: {} });

	test('says that nothing was found, and still offers to add', async ({ soundboard, playlists }) => {
		await soundboard.startAndWaitUntilLoaded();

		await playlists.expectNoneFoundLine(true);
	});
});

test('a folder with something in it has no such line', async ({ soundboard, playlists }) => {
	await soundboard.startAndWaitUntilLoaded();

	await playlists.expectNoneFoundLine(false);
});

test.describe('the system taking the audio away', () => {
	test.beforeEach(async ({ soundboard }) => {
		await soundboard.startAndWaitUntilLoaded();
	});

	test('closes an open context menu', async ({ sounds, splash, audio }) => {
		await sounds.openMenu('Base Connected');
		await sounds.expectMenuOpen(true);

		await audio.suspend();

		await splash.expectVisible('Audio paused by the system. Click to resume.');
		await sounds.expectMenuOpen(false);
	});

	test('leaves an open Customize dialog underneath the splash, as it was', async ({ sounds, dialogs, splash, audio }) => {
		await sounds.useMenu('Base Connected', 'Customize');
		await dialogs.soundEditor.setVolume('-6');

		await audio.suspend();
		await splash.expectVisible('Audio paused by the system. Click to resume.');
		await splash.click();
		await audio.resume();
		await splash.expectHidden();

		await dialogs.soundEditor.expectOpen();
		await dialogs.soundEditor.expectVolume('-6.0 dB');
	});
});

test.describe('a context menu', () => {
	test.beforeEach(async ({ soundboard, sounds }) => {
		await soundboard.startAndWaitUntilLoaded();
		await sounds.openMenu('Base Connected');
		await sounds.expectMenuOpen(true);
	});

	test('closes on a click outside it, and the click does not play anything', async ({ page, sounds, audio }) => {
		await page.mouse.click(5, 5);

		await sounds.expectMenuOpen(false);
		await audio.expectNothingPlaying();
	});

	test('closes on Esc', async ({ page, sounds }) => {
		await page.keyboard.press('Escape');

		await sounds.expectMenuOpen(false);
	});
});

test.describe('the debug view', () => {
	test.beforeEach(async ({ soundboard }) => {
		await soundboard.startAndWaitUntilLoaded();
	});

	test('opens from its button and says so while no voice is playing', async ({ header }) => {
		await header.expectDebugOpen(false);

		await header.toggleDebug();

		await header.expectDebugOpen(true);
		await header.expectDebugEmpty();
	});

	test('lists the voices the engine was asked to play, with their status', async ({ sounds, header, audio }) => {
		await audio.script('Base Connected', { duration: 1 });
		await header.toggleDebug();

		await sounds.click('Base Connected');

		await header.expectDebugVoice('Base Connected', 'playing');
		await audio.advance(1000);
		await header.expectDebugVoice('Base Connected', 'ended');
	});

	test('closes with the button again, and with Esc when nothing else is open', async ({ page, header }) => {
		await header.toggleDebug();
		await header.expectDebugOpen(true);

		await header.toggleDebug();
		await header.expectDebugOpen(false);

		await header.toggleDebug();
		await page.keyboard.press('Escape');
		await header.expectDebugOpen(false);
	});

	test('Esc closes a dialog on top of it first and leaves the panel open', async ({ page, sounds, dialogs, header }) => {
		await header.toggleDebug();
		await sounds.useMenu('Base Connected', 'Customize');

		await page.keyboard.press('Escape');

		await dialogs.soundEditor.expectClosed();
		await header.expectDebugOpen(true);
	});
});
