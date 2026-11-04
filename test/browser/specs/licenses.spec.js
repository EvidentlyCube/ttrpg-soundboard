import { test as base } from '@playwright/test';
import { expect, test } from '../support/fixtures.js';
import { startApp } from '../support/app.js';

/** @param {import('@playwright/test').Page} page */
async function openLicenses(page) {
	await page.locator('[data-app-menu]').click();
	await page.getByRole('menuitem', { name: 'Licenses' }).click();
}

/**
 * What the dialog shows run from source: the app and Tailwind with their texts, Node.js with a link instead, and the
 * programs it runs with their websites.
 * @param {import('@playwright/test').Page} page
 */
async function expectLicenses(page) {
	const licenses = page.locator('[data-licenses]');
	await expect(licenses.locator('[data-license-row]')).toHaveCount(3);
	await expect(licenses.locator('[data-license-row=app]')).toContainText(/TTRPG Soundboard\s*\d+\.\d+\.\d+/);
	await expect(licenses.locator('[data-license-row=app]')).toContainText('The Unlicense');
	await expect(licenses.locator('[data-license-row=tailwind]')).toContainText(/Tailwind CSS\s*\d+\.\d+\.\d+/);
	const node = licenses.locator('[data-license-row=node]');
	await expect(node).toContainText(process.versions.node);
	await expect(node.locator('[data-license-toggle]')).toHaveCount(0);
	await expect(node.getByRole('link', { name: 'Read it online' })).toHaveAttribute('href', 'https://github.com/nodejs/node/blob/main/LICENSE');
	await expect(licenses.locator('[data-license-external=yt-dlp] a')).toHaveAttribute('href', 'https://github.com/yt-dlp/yt-dlp');
	await expect(licenses.locator('[data-license-external=ffmpeg] a')).toHaveAttribute('href', 'https://ffmpeg.org');
}

test('the board’s menu opens the Licenses dialog, whose texts unfold one at a time', async ({ page, soundboard }) => {
	await test.step('Open the page and choose Licenses in the menu', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await openLicenses(page);
	});

	await test.step('It lists the parts with their versions and licenses, then the programs it runs', async () => {
		await expectLicenses(page);
	});

	await test.step('Show license unfolds the app’s text, and Hide license folds it again', async () => {
		const row = page.locator('[data-license-row=app]');
		const text = row.locator('[data-license-text]');
		await expect(text).toBeHidden();
		await row.locator('[data-license-toggle]').click();
		await expect(text).toContainText('This is free and unencumbered software released into the public domain.');
		await expect(row.locator('[data-license-toggle]')).toHaveText('Hide license');
		await expect(page.locator('[data-license-row=tailwind] [data-license-text]')).toBeHidden();
		await row.locator('[data-license-toggle]').click();
		await expect(text).toBeHidden();
	});
});

/** @type {import('@playwright/test').Fixtures<{ app: Awaited<ReturnType<typeof startApp>>, args: string[] }, {}, import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions>} */
const appFixtures = {
	args: [[], { option: true }],
	app: async ({ args }, use) => {
		const app = await startApp(args);
		await use(app);
		await app.stop();
	},
};

base.extend(appFixtures)('the Selector’s menu opens the same Licenses dialog', async ({ page, app }) => {
	await base.step('Open the Selector and choose Licenses in its ☰ menu', async () => {
		await page.goto(app.url);
		await expect(page.locator('[data-app-menu]')).toBeVisible();
		await openLicenses(page);
	});

	await base.step('It lists the same parts and programs', async () => {
		await expectLicenses(page);
		await expect(page.locator('[data-license-row=tailwind] [data-license-toggle]')).toHaveText('Show license');
	});
});
