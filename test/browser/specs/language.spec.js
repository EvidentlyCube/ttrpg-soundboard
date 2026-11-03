import { expect, test as base } from '@playwright/test';
import { translation as english } from '../../../public/app/i18n/en.js';
import { translation as polish } from '../../../public/app/i18n/pl.js';
import { startApp } from '../support/app.js';

/** @type {import('@playwright/test').Fixtures<{ app: Awaited<ReturnType<typeof startApp>>, args: string[] }, {}, import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions>} */
const fixtures = {
	args: [[], { option: true }],
	app: async ({ args }, use) => {
		const app = await startApp(args);
		await use(app);
		await app.stop();
	},
};
const test = base.extend(fixtures);
const pl = polish.messages;

test('the language chosen in the Selector applies to every page, until Automatic brings the browser’s back', async ({ page, browser, app }) => {
	await test.step('The Selector starts in the browser’s language, English, and offers Polish by its own name', async () => {
		await page.goto(app.url);
		await expect(page.locator('h1')).toHaveText(english.messages.selector.title);
		await expect(page.locator('[data-language] option')).toHaveText([english.messages.selector.automatic, 'English', 'Polski']);
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	});

	await test.step('Choosing Polish reloads the Selector in Polish, server messages included', async () => {
		await page.locator('[data-language]').selectOption('pl');
		await expect(page.locator('h1')).toHaveText(pl.selector.title);
		await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
		await expect(page.locator('[data-language]')).toHaveValue('pl');
		// The home folder itself may not be opened; the server's reason comes with a code.
		await expect(page.locator('[data-folder-summary]')).toHaveText(pl.errors.folder.container);
	});

	await test.step('The Initializer and the board follow, with numbers written the Polish way', async () => {
		await page.locator('[data-path-input]').fill(app.board);
		await page.locator('[data-path-input]').press('Enter');
		await page.locator('[data-folder-open]').click();
		await expect(page.locator('[data-answer=no]')).toHaveText(pl.initializer.titlesNo);
		await page.locator('[data-answer=no]').click();
		await expect(page.locator('[data-splash]')).toContainText(pl.splash.chooseMode);
		await page.locator('[data-start-mode=standalone]').click();
		await expect(page.getByText(pl.board.playlists, { exact: true })).toBeVisible();
		await expect(page.locator('[data-panic-button]')).toHaveText(pl.panic.fade);
		await expect(page.locator('[data-volume=master] [data-gain-readout]')).toHaveText(/^0,0 dB$|^[+−]\d+,\d dB$/);
	});

	await test.step('Another browser gets the same language, since it is the app’s', async () => {
		const other = await browser.newPage({ locale: 'en-US' });
		await other.goto(app.url);
		await expect(other.locator('[data-splash]')).toContainText(pl.splash.chooseMode);
		await other.close();
	});

	await test.step('Automatic brings back the browser’s language', async () => {
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: pl.menu.changeSoundboard }).click();
		await page.locator('[data-language]').selectOption('');
		await expect(page.locator('h1')).toHaveText(english.messages.selector.title);
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	});
});
