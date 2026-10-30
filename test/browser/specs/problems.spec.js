import { expect } from '@playwright/test';
import { test } from '../support/fixtures.js';

test.describe("a folder with files that can't be used", () => {
	test.use({ library: { 'Song.wav': 'not audio', 'Boom.mp3': 'not really audio' } });

	test.beforeEach(async ({ soundboard }) => {
		await soundboard.startAndWaitUntilLoaded();
	});

	test('the header counts the problems and the dialog lists them, errors first', async ({ page, header }) => {
		await header.expectProblems('2 problems');
		await header.openProblems();

		const rows = page.getByRole('dialog', { name: 'Problems' }).locator('[data-problem]');
		await expect(rows).toHaveCount(2);
		await expect(rows.first()).toContainText('Unknown duration');
		await expect(rows.first()).toHaveAttribute('data-severity', 'error');
		await expect(rows.last()).toContainText('Song.wav');
	});

	test('dismissing the problems one by one empties the list and closes the dialog', async ({ page, header }) => {
		await header.openProblems();
		const dialog = page.getByRole('dialog', { name: 'Problems' });

		await dialog.locator('[data-dismiss]').first().click();
		await header.expectProblems('1 problem');
		await dialog.locator('[data-dismiss]').first().click();

		await expect(dialog).toBeHidden();
		await header.expectNoProblems();
	});

	test('Dismiss all clears them, and a reload does not bring them back', async ({ page, soundboard, splash, header }) => {
		await header.openProblems();
		await page.getByRole('button', { name: 'Dismiss all' }).click();
		await header.expectNoProblems();

		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();
		await header.expectNoProblems();
	});
});

test('a library without problems has no button', async ({ soundboard, header }) => {
	await soundboard.startAndWaitUntilLoaded();
	await header.expectNoProblems();
});
