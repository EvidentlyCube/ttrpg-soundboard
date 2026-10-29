import { expect, test } from '@playwright/test';
import { startSoundboardServer } from '../support/server.js';

/** @type {Awaited<ReturnType<typeof startSoundboardServer>>} */
let soundboard;

test.beforeEach(async () => {
	soundboard = await startSoundboardServer();
});

test.afterEach(async () => {
	await soundboard.stop();
});

test('the page loads and shows the splash', async ({ page }) => {
	await page.goto(soundboard.url);

	await expect(page.getByText('Click anywhere to start')).toBeVisible();
});
