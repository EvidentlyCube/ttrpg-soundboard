import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test('a refresh that fails lists each problem file, and fixing it lets the next refresh through', async ({ soundboard, splash, header, sounds, disk }) => {
	await disk.write('Sound MP3 no title tag.mp3.json', '{ this is not json');
	await header.expectExternalChangesButton();

	await header.refreshExternalChanges();

	await header.expectRefreshFailure('Sound MP3 no title tag.mp3.json', 'JSON');
	await header.dismissRefreshFailure();
	await header.expectExternalChangesButton();

	await disk.write('Sound MP3 no title tag.mp3.json', '{}');
	await header.refreshExternalChanges();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await sounds.expectShown('Sound MP3 no title tag.mp3');
});

test('a missing .soundboard file brings the splash back for good, with a restart message', async ({ splash, header, disk }) => {
	await disk.remove('.soundboard');
	await header.expectExternalChangesButton();

	await header.refreshExternalChanges();

	await splash.expectVisible('The audio folder needs a restart');
});

test('getting the window back asks the server to check the folder', async ({ page }) => {
	const check = page.waitForRequest((request) => request.url().endsWith('/api/changes/check') && request.method() === 'POST');

	await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));

	await check;
});

test('replacing a file with an identical copy brings no button', async ({ soundboard, header, disk }) => {
	await disk.addCopyOf('Sound MP3 with title tag.mp3', 'Sound MP3 with title tag.mp3');

	await soundboard.waitForTheFolderToSettle();

	await header.expectNoExternalChangesButton();
});

test('the button is disabled and says Refreshing… while the server works', async ({ page, header, disk }) => {
	let release = () => {};
	const gate = new Promise((resolve) => {
		release = () => resolve(undefined);
	});
	await page.route('**/api/refresh', async (route) => {
		await gate;
		await route.continue();
	});
	await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');
	await header.expectExternalChangesButton();

	await header.refreshExternalChanges();

	await header.expectRefreshing();
	release();
});

test('a volume changed just before clicking Refresh is saved before the page reloads', async ({ soundboard, splash, header, disk }) => {
	await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');
	await header.expectExternalChangesButton();
	await header.setVolume('music', '-6');

	await header.refreshExternalChanges();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await header.expectVolume('music', '-6.0 dB');
});
