import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('a refresh that fails lists each problem file, and fixing it lets the next refresh through', async ({ soundboard, splash, header, sounds, disk }) => {
	await test.step("Break a sound's settings file: the refresh button appears", async () => {
		await disk.write('Sound MP3 no title tag.mp3.json', '{ this is not json');
		await header.expectExternalChangesButton();
	});

	await test.step('Refresh: the failure names the file and the problem', async () => {
		await header.refreshExternalChanges();
		await header.expectRefreshFailure('Sound MP3 no title tag.mp3.json', 'JSON');
	});

	await test.step('Dismiss it: the button is still there', async () => {
		await header.dismissRefreshFailure();
		await header.expectExternalChangesButton();
	});

	await test.step('Fix the file and refresh again', async () => {
		await disk.write('Sound MP3 no title tag.mp3.json', '{}');
		await header.refreshExternalChanges();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('The sound is there', async () => {
		await sounds.expectShown('Sound MP3 no title tag.mp3');
	});
});

test('a missing .soundboard file brings the splash back for good, with a restart message', async ({ splash, header, disk }) => {
	await test.step('Delete the .soundboard file: the refresh button appears', async () => {
		await disk.remove('.soundboard');
		await header.expectExternalChangesButton();
	});

	await test.step('Refresh', async () => {
		await header.refreshExternalChanges();
	});

	await test.step('The splash asks for a restart', async () => {
		await splash.expectVisible('The audio folder needs a restart');
	});
});

test('getting the window back asks the server to check the folder', async ({ page }) => {
	const check = page.waitForRequest((request) => request.url().endsWith('/api/changes/check') && request.method() === 'POST');

	await test.step('The window gets focus again', async () => {
		await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
	});

	await test.step('The page asks the server to check', async () => {
		await check;
	});
});

test('replacing a file with an identical copy brings no button', async ({ soundboard, header, disk }) => {
	await test.step('Overwrite a file with a copy of itself', async () => {
		await disk.addCopyOf('Sound MP3 with title tag.mp3', 'Sound MP3 with title tag.mp3');
	});

	await test.step('Wait for the folder watcher to settle', async () => {
		await soundboard.waitForTheFolderToSettle();
	});

	await test.step('No refresh button appears', async () => {
		await header.expectNoExternalChangesButton();
	});
});

test('the button is disabled and says Refreshing… while the server works', async ({ page, soundboard, splash, header, disk }) => {
	let release = () => {};
	await test.step("Make the server's refresh wait until the test lets it go", async () => {
		const gate = new Promise((resolve) => {
			release = () => resolve(undefined);
		});
		await page.route('**/api/refresh', async (route) => {
			await gate;
			await route.continue();
		});
	});

	await test.step('Copy a file into the folder: the refresh button appears', async () => {
		await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');
		await header.expectExternalChangesButton();
	});

	await test.step('Click it: the button says Refreshing…', async () => {
		await header.refreshExternalChanges();
		await header.expectRefreshing();
	});

	await test.step('Let the server finish and click through the splash', async () => {
		release();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});
});

test('a volume changed just before clicking Refresh is saved before the page reloads', async ({ soundboard, splash, header, disk }) => {
	await test.step('Copy a file into the folder and change the music volume', async () => {
		await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');
		await header.expectExternalChangesButton();
		await header.setVolume('music', '-6');
	});

	await test.step('Refresh at once and click through the splash', async () => {
		await header.refreshExternalChanges();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('The volume is still the new one', async () => {
		await header.expectVolume('music', '-6.0 dB');
	});
});
