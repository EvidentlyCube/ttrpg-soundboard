import { expect, test } from '../support/fixtures.js';

test('the page shows the splash and only asks for the name and whether a host exists before the click', async ({ page, soundboard, splash }) => {
	/** @type {string[]} */
	const requests = [];

	await test.step('Record the requests and open the page', async () => {
		page.on('request', (request) => requests.push(new URL(request.url()).pathname));
		await soundboard.open();
	});

	await test.step('The splash is shown and the only API calls were the name and the host check', async () => {
		await splash.expectVisible();
		await expect.poll(() => requests.filter((path) => path.startsWith('/api/'))).toEqual(['/api/settings', '/api/remote']);
	});
});

test('the splash sits between the header and the footer, where only Info, Licenses and Change soundboard work yet', async ({ page, soundboard, splash }) => {
	await test.step('Open the page', async () => {
		await soundboard.open();
		await splash.expectVisible();
	});

	await test.step('The header has the menu and the title only, and the footer a disabled Stop All', async () => {
		const header = page.locator('[data-start-header]');
		await expect(header.locator('[data-app-title]')).toHaveText(/\S/);
		await expect(header.locator('button')).toHaveCount(1);
		await expect(header.locator('[data-app-menu]')).toBeVisible();
		await expect(page.locator('[data-player-dock]')).toContainText('No playlist playing');
		await expect(page.locator('[data-panic-button]')).toBeDisabled();
	});

	await test.step('The menu lists every item, with only Info, Licenses and Change soundboard enabled', async () => {
		await page.locator('[data-app-menu]').click();
		const items = page.getByRole('menuitem');
		await expect(items).toHaveText(['Become host', 'Options', 'Info', 'Licenses', 'Debug', 'Change soundboard']);
		for (const name of ['Become host', 'Options', 'Debug']) {
			await expect(page.getByRole('menuitem', { name })).toBeDisabled();
		}
	});

	await test.step('Info opens over the splash', async () => {
		await page.getByRole('menuitem', { name: 'Info' }).click();
		await expect(page.locator('[data-info-row=app]')).toHaveText(/^\d+\.\d+\.\d+$/);
	});
});

test('clicking the splash loads the soundboard with the library', async ({ soundboard, splash, playlists }) => {
	await test.step('Open the page and click the splash', async () => {
		await soundboard.open();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('The playlists are shown', async () => {
		await playlists.expectShown('Music MP3', 'Music Mix', 'Music Ogg', 'Music Order');
	});
});

test('starting plays no audio and asks for no media files', async ({ page, soundboard }) => {
	/** @type {string[]} */
	const media = [];

	await test.step('Record media requests and start the page', async () => {
		page.on('request', (request) => request.url().match(/\.(mp3|ogg)$/i) && media.push(request.url()));
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('No media file was requested', async () => {
		expect(media).toEqual([]);
	});
});

test.describe('with a library of its own', () => {
	test.use({ library: { Rain: { 'drops.mp3': 'not really audio', 'storm.mp3': 'not really audio' } } });

	test('shows that library', async ({ soundboard, playlists }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});

		await test.step('The playlist from that library is shown', async () => {
			await playlists.expectShown('Rain');
		});
	});
});

test('the page runs on the fake audio engine, which the click unlocks', async ({ page, soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('The engine was unlocked exactly once', async () => {
		const unlocks = await page.evaluate(() => soundboardTest.engine.unlockCount);
		expect(unlocks).toBe(1);
	});
});

test('the page works when opened as localhost, which is the same server under another name', async ({ page, soundboard, splash, playlists }) => {
	await test.step('Open the page, then open it again as localhost', async () => {
		await soundboard.open();
		await page.goto(page.url().replace('127.0.0.1', 'localhost'));
	});

	await test.step('Click the splash', async () => {
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('The playlists are shown', async () => {
		await playlists.expectShown('Music MP3', 'Music Mix', 'Music Ogg', 'Music Order');
	});
});
