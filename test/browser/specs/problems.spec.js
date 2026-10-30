import { expect } from '@playwright/test';
import { test } from '../support/fixtures.js';

test.describe("a folder with files that can't be used", () => {
	test.use({ library: { 'Song.wav': 'not audio', 'Boom.mp3': 'not really audio' } });

	test.beforeEach(async ({ soundboard }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});
	});

	test('the header counts the problems and the dialog lists them, errors first', async ({ page, header }) => {
		await test.step('The header counts two problems', async () => {
			await header.expectProblems('2 problems');
		});

		await test.step('Open the list', async () => {
			await header.openProblems();
		});

		await test.step('It has two rows, the error before the other', async () => {
			const rows = page.getByRole('dialog', { name: 'Problems' }).locator('[data-problem]');
			await expect(rows).toHaveCount(2);
			await expect(rows.first()).toContainText('Unknown duration');
			await expect(rows.first()).toHaveAttribute('data-severity', 'error');
			await expect(rows.last()).toContainText('Song.wav');
		});
	});

	test('dismissing the problems one by one empties the list and closes the dialog', async ({ page, header }) => {
		const dialog = page.getByRole('dialog', { name: 'Problems' });

		await test.step('Open the list', async () => {
			await header.openProblems();
		});

		await test.step('Dismiss the first problem: one is left', async () => {
			await dialog.locator('[data-dismiss]').first().click();
			await header.expectProblems('1 problem');
		});

		await test.step('Dismiss the last one: the dialog closes and the header has no count', async () => {
			await dialog.locator('[data-dismiss]').first().click();
			await expect(dialog).toBeHidden();
			await header.expectNoProblems();
		});
	});

	test('Dismiss all clears them, and a reload does not bring them back', async ({ page, soundboard, splash, header }) => {
		await test.step('Open the list and click Dismiss all', async () => {
			await header.openProblems();
			await page.getByRole('button', { name: 'Dismiss all' }).click();
			await header.expectNoProblems();
		});

		await test.step('Reload the page', async () => {
			await soundboard.reload();
			await splash.click();
			await soundboard.waitUntilLoaded();
		});

		await test.step('Still no problems', async () => {
			await header.expectNoProblems();
		});
	});
});

test('a library without problems has no button', async ({ soundboard, header }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('The header has no problems button', async () => {
		await header.expectNoProblems();
	});
});
