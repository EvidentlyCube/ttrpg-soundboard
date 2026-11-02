import { expect, test } from '../support/fixtures.js';

/** @param {import('@playwright/test').Page} page */
async function openInfo(page) {
	await page.locator('[data-app-menu]').click();
	await page.getByRole('menuitem', { name: 'Info' }).click();
}

test.describe('with yt-dlp outdated', () => {
	test.use({
		downloadTools: 'both',
		ytDlpUpdate: { state: 'outdated', current: '2026.08.19', latest: '2026.10.26', error: 'Insufficient permissions to write to /usr/bin' },
	});

	test('the failed update is a problem, and Info shows the versions with the update', async ({ page, soundboard, header }) => {
		await test.step('Open the page: the Problems button counts the update', async () => {
			await soundboard.startAndWaitUntilLoaded();
			await header.expectProblems('1 problem');
		});

		await test.step('The Problems dialog explains it', async () => {
			await header.openProblems();
			const row = page.locator('[data-problem="ytdlp-outdated:yt-dlp"]');
			await expect(row).toContainText('yt-dlp outdated');
			await expect(row).toContainText('2026.10.26 is available (installed: 2026.08.19), but the update failed: Insufficient permissions');
			await page.keyboard.press('Escape');
		});

		await test.step('Choose Info in the menu', async () => {
			await openInfo(page);
		});

		await test.step('It shows every version, and the update in yellow with the reason as a tooltip', async () => {
			const info = page.locator('[data-info]');
			await expect(info.locator('[data-info-row=app]')).toHaveText(/^\d+\.\d+\.\d+$/);
			await expect(info.locator('[data-info-row=yt-dlp]')).toContainText('2026.08.19');
			const status = info.locator('[data-update-state=outdated]');
			await expect(status).toHaveText('2026.10.26 available, but the update failed');
			await expect(status).toHaveAttribute('title', 'Insufficient permissions to write to /usr/bin');
			await expect(info.locator('[data-info-row=ffmpeg]')).toHaveText('7.1');
		});
	});
});

test('without the tools, Info says they are not installed', async ({ page, soundboard }) => {
	await test.step('Open the page and choose Info', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await openInfo(page);
	});

	await test.step('yt-dlp and ffmpeg are not installed, with no update line', async () => {
		const info = page.locator('[data-info]');
		await expect(info.locator('[data-info-row=yt-dlp]')).toHaveText('Not installed');
		await expect(info.locator('[data-info-row=ffmpeg]')).toHaveText('Not installed');
		await expect(info.locator('[data-update-state]')).toHaveCount(0);
	});
});
