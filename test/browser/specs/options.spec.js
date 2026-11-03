import { expect, test } from '../support/fixtures.js';

test('Options renames the soundboard in the header and the tab title, and the name is kept after a reload', async ({ page, soundboard, splash, audio }) => {
	const title = page.locator('[data-app-title]');

	await test.step('Without a name, the folder’s name shows', async () => {
		await soundboard.open();
		await splash.expectVisible();
		const folderName = await title.textContent();
		expect(folderName).not.toBe('Soundboard');
		await expect(page).toHaveTitle(`${folderName} · Soundboard`);
		await soundboard.startAndWaitUntilLoaded();
		await expect(title).toHaveText(folderName ?? '');
	});

	await test.step('Type a name in Options: the header and the tab follow as it is typed', async () => {
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: 'Options' }).click();
		const field = page.locator('[data-options-name]');
		await expect(field).toBeFocused();
		await expect(field).toHaveValue('');
		await field.fill('Tavern night');
		await expect(title).toHaveText('Tavern night');
		await expect(page).toHaveTitle('Tavern night · Soundboard');
	});

	await test.step('After the save and a reload, the splash already shows it', async () => {
		await audio.advance(500);
		const settingsUrl = new URL('/api/settings', page.url()).href;
		await expect.poll(async () => (await (await page.request.get(settingsUrl)).json()).name).toBe('Tavern night');
		await page.reload();
		await splash.expectVisible();
		await expect(title).toHaveText('Tavern night');
	});
});
