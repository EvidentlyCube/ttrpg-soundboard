import { test } from '../support/fixtures.js';

test('when the library cannot be loaded the splash says so and a click tries again', async ({ page, soundboard, splash }) => {
	await test.step('Make loading the library fail', async () => {
		await soundboard.open();
		await page.route('**/api/library', (route) => route.abort());
	});

	await test.step('Click the splash: it says the start failed', async () => {
		await splash.click();
		await splash.expectVisible('Could not start the soundboard. Click to retry.');
	});

	await test.step('Let loading work again and click to retry', async () => {
		await page.unroute('**/api/library');
		await splash.click();
		await soundboard.waitUntilLoaded();
	});
});

test.describe('an empty folder', () => {
	test.use({ library: {} });

	test('says that nothing was found, and still offers to add', async ({ soundboard, playlists }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});

		await test.step('The "none found" line is shown', async () => {
			await playlists.expectNoneFoundLine(true);
		});
	});
});

test('a folder with something in it has no such line', async ({ soundboard, playlists }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('The "none found" line is not shown', async () => {
		await playlists.expectNoneFoundLine(false);
	});
});

test.describe('the system taking the audio away', () => {
	test.beforeEach(async ({ soundboard }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});
	});

	test('closes an open context menu', async ({ sounds, splash, audio }) => {
		await test.step("Open a sound's menu", async () => {
			await sounds.openMenu('Base Connected');
			await sounds.expectMenuOpen(true);
		});

		await test.step('The system suspends the audio', async () => {
			await audio.suspend();
		});

		await test.step('The splash asks for a click and the menu is closed', async () => {
			await splash.expectVisible('Audio paused by the system. Click to resume.');
			await sounds.expectMenuOpen(false);
		});
	});

	test('leaves an open Customize dialog underneath the splash, as it was', async ({ sounds, dialogs, splash, audio }) => {
		await test.step('Open the Customize dialog and change the volume', async () => {
			await sounds.useMenu('Base Connected', 'Customize');
			await dialogs.soundEditor.setVolume('-6');
		});

		await test.step('The system suspends the audio: the splash asks for a click', async () => {
			await audio.suspend();
			await splash.expectVisible('Audio paused by the system. Click to resume.');
		});

		await test.step('Click the splash and let the audio resume', async () => {
			await splash.click();
			await audio.resume();
			await splash.expectHidden();
		});

		await test.step('The dialog is still open with the changed volume', async () => {
			await dialogs.soundEditor.expectOpen();
			await dialogs.soundEditor.expectVolume('-6.0 dB');
		});
	});
});

test.describe('a context menu', () => {
	test.beforeEach(async ({ soundboard, sounds }) => {
		await test.step("Open a sound's menu", async () => {
			await soundboard.startAndWaitUntilLoaded();
			await sounds.openMenu('Base Connected');
			await sounds.expectMenuOpen(true);
		});
	});

	test('closes on a click outside it, and the click does not play anything', async ({ page, sounds, audio }) => {
		await test.step('Click outside the menu', async () => {
			await page.mouse.click(5, 5);
		});

		await test.step('The menu closes and nothing plays', async () => {
			await sounds.expectMenuOpen(false);
			await audio.expectNothingPlaying();
		});
	});

	test('closes on Esc', async ({ page, sounds }) => {
		await test.step('Press Esc', async () => {
			await page.keyboard.press('Escape');
		});

		await test.step('The menu closes', async () => {
			await sounds.expectMenuOpen(false);
		});
	});
});

test.describe('the debug view', () => {
	test.beforeEach(async ({ soundboard }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});
	});

	test('opens from its button and says so while no voice is playing', async ({ header }) => {
		await test.step('It starts closed', async () => {
			await header.expectDebugOpen(false);
		});

		await test.step('Click its button', async () => {
			await header.toggleDebug();
		});

		await test.step('It opens and says no voice is playing', async () => {
			await header.expectDebugOpen(true);
			await header.expectDebugEmpty();
		});
	});

	test('lists the voices the engine was asked to play, with their status', async ({ sounds, header, audio }) => {
		await test.step('Make the sound 1 s long and open the debug view', async () => {
			await audio.script('Base Connected', { duration: 1 });
			await header.toggleDebug();
		});

		await test.step('Play the sound: the view lists its voice as playing', async () => {
			await sounds.click('Base Connected');
			await header.expectDebugVoice('Base Connected', 'playing');
		});

		await test.step('Let it end: the voice is listed as ended', async () => {
			await audio.advance(1000);
			await header.expectDebugVoice('Base Connected', 'ended');
		});
	});

	test('closes with the button again, and with Esc when nothing else is open', async ({ page, header }) => {
		await test.step('Open it and close it with the button', async () => {
			await header.toggleDebug();
			await header.expectDebugOpen(true);
			await header.toggleDebug();
			await header.expectDebugOpen(false);
		});

		await test.step('Open it and close it with Esc', async () => {
			await header.toggleDebug();
			await page.keyboard.press('Escape');
			await header.expectDebugOpen(false);
		});
	});

	test('Esc closes a dialog on top of it first and leaves the panel open', async ({ page, sounds, dialogs, header }) => {
		await test.step('Open the debug view and a Customize dialog on top of it', async () => {
			await header.toggleDebug();
			await sounds.useMenu('Base Connected', 'Customize');
		});

		await test.step('Press Esc', async () => {
			await page.keyboard.press('Escape');
		});

		await test.step('The dialog closes and the debug view stays open', async () => {
			await dialogs.soundEditor.expectClosed();
			await header.expectDebugOpen(true);
		});
	});
});
