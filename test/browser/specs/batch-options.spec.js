import { expect, test } from '../support/fixtures.js';

const PLAYLISTS = ['Music Mix', 'Music MP3', 'Music Ogg', 'Music Order'];
const SOUNDS = ['Sound MP3 no title tag.mp3', 'Sound MP3 with title tag.mp3', 'Sound OGG no title tag.ogg', 'Sound OGG with title tag.ogg'];

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */

/** @param {Page} page */
async function openBatchTab(page) {
	await page.locator('[data-app-menu]').click();
	await page.getByRole('menuitem', { name: 'Options' }).click();
	await page.getByRole('tab', { name: 'Batch' }).click();
}

/**
 * @param {Page} page
 * @param {string} title the card's title, such as `Playlists: Fades`
 */
function batchCard(page, title) {
	return page.locator('[data-batch-card]').filter({ has: page.getByRole('heading', { name: title }) });
}

/**
 * Holds the card's Apply button for as long as given.
 * @param {Page} page
 * @param {Locator} card
 * @param {number} ms
 */
async function holdApply(page, card, ms) {
	await card.locator('[data-hold-button]').hover();
	await page.mouse.down();
	await page.waitForTimeout(ms);
	await page.mouse.up();
}

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test('a setting is disabled until its box is checked, and Apply until one is', async ({ page }) => {
	await openBatchTab(page);
	const card = batchCard(page, 'Playlists: Fades');
	const row = card.locator('[data-batch-row="fadeIn"]');
	const apply = card.locator('[data-hold-button]');

	await test.step('At first nothing in the card can be used', async () => {
		await expect(page.locator('[data-batch-options]')).toContainText('change all playlists or all sound effects at once');
		await expect(row.locator('[inert]')).toHaveCount(1);
		await expect(apply).toBeDisabled();
	});

	await test.step('Checking the box enables the setting and Apply', async () => {
		await card.locator('[data-batch-apply="fadeIn"]').check();
		await expect(row.locator('[inert]')).toHaveCount(0);
		await expect(apply).toBeEnabled();
	});

	await test.step('Unchecking it disables both again', async () => {
		await card.locator('[data-batch-apply="fadeIn"]').uncheck();
		await expect(row.locator('[inert]')).toHaveCount(1);
		await expect(apply).toBeDisabled();
	});
});

test('holding Apply for a second gives every playlist the checked settings and resets the card', async ({ page, disk }) => {
	await openBatchTab(page);
	const fades = batchCard(page, 'Playlists: Fades');
	const order = batchCard(page, 'Playlists: Playback order');

	await test.step('Set a fade-in and apply it', async () => {
		await fades.locator('[data-batch-apply="fadeIn"]').check();
		await fades.locator('[data-batch-row="fadeIn"] [data-seconds-slider]').fill('2.5');
		await holdApply(page, fades, 1200);
	});

	await test.step('Every playlist has it, a toast says how many changed, and the box is cleared', async () => {
		for (const playlist of PLAYLISTS) {
			await disk.expectOptions(playlist, { fadeIn: 2.5 });
		}
		await expect(page.locator('[data-toast]')).toHaveText('Changes applied to 4 playlists.');
		await expect(fades.locator('[data-batch-apply="fadeIn"]')).not.toBeChecked();
		await expect(fades.locator('[data-hold-button]')).toBeDisabled();
		await expect(fades.locator('[data-batch-row="fadeIn"] [data-batch-varies]')).toBeHidden();
	});

	await test.step('Applying an order every playlist already has changes nothing', async () => {
		await order.locator('[data-batch-apply="order"]').check();
		await order.locator('[data-radio-value="shuffle"]').check();
		await holdApply(page, order, 1200);
		await expect(page.locator('[data-toast]')).toHaveText('Changes applied to 4 playlists.');
		await order.locator('[data-batch-apply="order"]').check();
		await holdApply(page, order, 1200);
		await expect(page.locator('[data-toast]')).toHaveText('Every playlist already had these settings; nothing changed.');
	});
});

test('releasing Apply early changes nothing', async ({ page, disk }) => {
	await openBatchTab(page);
	const card = batchCard(page, 'Playlists: Repeat');
	await card.locator('[data-batch-apply="trackLooping"]').check();
	await card.locator('[data-batch-row="trackLooping"] [data-radio-value="true"]').check();
	await holdApply(page, card, 500);
	await expect(card.locator('[data-batch-apply="trackLooping"]')).toBeChecked();
	await expect(card.locator('[data-hold-button]')).toHaveText('Hold to apply');
	// A playlist that was never customized has no options file yet.
	const options = await disk.options(PLAYLISTS[0]).catch(() => /** @type {Record<string, unknown>} */ ({}));
	expect(options.trackLooping).not.toBe(true);
});

test('the sound cards change every sound effect', async ({ page, disk }) => {
	await openBatchTab(page);
	const card = batchCard(page, 'Sound effects: Fades');
	await card.locator('[data-batch-apply="fadeOut"]').check();
	await card.locator('[data-batch-row="fadeOut"] [data-seconds-slider]').fill('1');
	await holdApply(page, card, 1200);
	for (const sound of SOUNDS) {
		await disk.expectOptions(sound, { fadeOut: 1 });
	}
	await expect(page.locator('[data-toast]')).toHaveText('Changes applied to 4 sound effects.');
});

test('a failed save is reported with how many failed', async ({ page }) => {
	await page.route('**/api/playlists/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk full' }) }));
	await openBatchTab(page);
	const card = batchCard(page, 'Playlists: Volume');
	await card.locator('[data-batch-apply="gain"]').check();
	await card.locator('[data-batch-row="gain"] [role="slider"]').press('ArrowDown');
	await holdApply(page, card, 1200);
	const toast = page.locator('[data-toast]');
	await expect(toast).toHaveText('Could not save 4 of 4 playlists.');
	await expect(toast).toHaveAttribute('data-tone', 'danger');
});
