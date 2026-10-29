import { expect, test } from '../support/fixtures.js';

test('the page shows the splash and nothing else happens before the click', async ({ page, soundboard, splash }) => {
	/** @type {string[]} */
	const requests = [];
	page.on('request', (request) => requests.push(new URL(request.url()).pathname));

	await soundboard.open();

	await splash.expectVisible();
	expect(requests.filter((path) => path.startsWith('/api/'))).toEqual([]);
});

test('clicking the splash loads the soundboard with the library', async ({ soundboard, splash, playlists }) => {
	await soundboard.open();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await playlists.expectShown('Music MP3', 'Music Mix', 'Music Ogg', 'Music Order');
});

test('starting plays no audio and asks for no media files', async ({ page, soundboard }) => {
	/** @type {string[]} */
	const media = [];
	page.on('request', (request) => request.url().match(/\.(mp3|ogg)$/i) && media.push(request.url()));

	await soundboard.startAndWaitUntilLoaded();

	expect(media).toEqual([]);
});

test.describe('with a library of its own', () => {
	test.use({ library: { Rain: { 'drops.mp3': 'not really audio', 'storm.mp3': 'not really audio' } } });

	test('shows that library', async ({ soundboard, playlists }) => {
		await soundboard.startAndWaitUntilLoaded();

		await playlists.expectShown('Rain');
	});
});

test('the page runs on the fake audio engine, which the click unlocks', async ({ page, soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();

	const unlocks = await page.evaluate(() => /** @type {any} */ (globalThis).soundboardTest.engine.unlockCount);
	expect(unlocks).toBeGreaterThan(0);
});
