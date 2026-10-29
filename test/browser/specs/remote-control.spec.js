import { expect, test } from '../support/fixtures.js';

/** The header's role label (DESIGN.md §9.15): "Host" or "Remote control", and none for a standalone page. */
const roleLabel = (/** @type {import('@playwright/test').Page} */ page) => page.locator('[data-role-label]');

test('the splash offers three ways to start', async ({ page, soundboard, splash }) => {
	await soundboard.open();
	await splash.expectVisible();
	await expect(page.locator('[data-start-mode]')).toHaveCount(3);
	await expect(page.locator('[data-remote-note]')).toHaveText('No host is running yet. It will work once one starts.');
});

test('a standalone page is not a host, and its menu offers to become one', async ({ page, soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
	await expect(roleLabel(page)).toBeHidden();
	await page.locator('[data-app-menu]').click();
	await expect(page.getByRole('menuitem', { name: 'Become host' })).toBeVisible();
});

test('choosing Host makes the page the host at once', async ({ page, soundboard, splash }) => {
	await soundboard.open();
	await splash.choose('host');
	await soundboard.waitUntilLoaded();

	await expect(roleLabel(page)).toBeVisible();
	await expect(roleLabel(page)).toHaveText('Host');
	await expect(page.locator('header[data-role]')).toHaveAttribute('data-role', 'host');
	await page.locator('[data-app-menu]').click();
	await expect(page.getByRole('menuitem', { name: 'Stop hosting' })).toBeVisible();
});

test('a remote control follows the host and controls it', async ({ page, soundboard, splash, playlists, footer }) => {
	await soundboard.open();
	await splash.choose('host');
	await soundboard.waitUntilLoaded();

	const remote = await page.context().newPage();
	await remote.goto(soundboard.url);
	await expect(remote.locator('[data-host-note]')).toHaveText('Another page is the host. You will be asked before it is replaced.');
	await remote.locator('[data-start-mode=remote]').click();
	await expect(remote.locator('[data-remote-view]')).toBeVisible();
	await expect(roleLabel(remote)).toHaveText('Remote control');
	await expect(remote.locator('[data-host-status]')).toHaveText('Host connected');

	await remote.locator('[data-playlist-id="Music MP3"]').click();
	await footer.expectPlayersCount(1);
	await expect(remote.locator('[data-remote-player="Music MP3"]')).toBeVisible();
	await expect(remote.locator('[data-remote-player="Music MP3"] [data-player-track]')).toHaveText('Piece by Piece');
	await expect(remote.locator('[data-playlist-id="Music MP3"]')).toHaveAttribute('data-active', 'true');

	await remote.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect(remote.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await playlists.expectStatus('Music MP3', 'Paused');
	await remote.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(remote.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

	await remote.getByRole('button', { name: 'Next', exact: true }).click();
	await expect(remote.locator('[data-remote-player="Music MP3"] [data-player-track]')).not.toHaveText('Piece by Piece');

	await remote.locator('[data-sound-id]').first().click();
	await expect(remote.locator('[data-sound-id][data-active="true"]')).toHaveCount(1);

	await remote.locator('[data-panic-button]').click();
	await footer.expectEmpty();
	await expect(remote.locator('[data-remote-player]')).toHaveCount(0);
});

test('a remote control with no host shows a notice, and never touches the audio', async ({ page, soundboard }) => {
	/** @type {string[]} */
	const media = [];
	await soundboard.open();
	page.on('request', (request) => request.url().includes('/media/') && media.push(request.url()));
	await page.locator('[data-start-mode=remote]').click();
	await expect(page.locator('[data-remote-view]')).toBeVisible();
	await expect(page.locator('[data-remote-notice]')).toContainText('No host is connected');
	await expect(page.locator('button[data-remote-action]')).toHaveCount(0);
	expect(media).toEqual([]);
	// Not even unlocked: the page has no audio to start.
	expect(await page.evaluate(() => globalThis.soundboardTest.engine.unlockCount)).toBe(0);
});

test('a second host must be confirmed by holding, and the first one becomes standalone with an error', async ({ page, soundboard, splash, header }) => {
	await soundboard.open();
	await splash.choose('host');
	await soundboard.waitUntilLoaded();

	const second = await page.context().newPage();
	await second.goto(soundboard.url);
	await second.locator('[data-start-mode=host]').click();
	const dialog = second.getByRole('dialog', { name: 'Replace the host?' });
	await expect(dialog).toBeVisible();
	await expect(second.locator('[data-role-label]')).toBeHidden();

	// A short press does nothing.
	await dialog.locator('[data-replace-host]').click();
	await expect(dialog).toBeVisible();
	await dialog.locator('[data-replace-host]').click({ delay: 1200 });
	await expect(dialog).toBeHidden();
	await expect(second.locator('[data-role-label]')).toHaveText('Host');

	await expect(roleLabel(page)).toBeHidden();
	await header.expectProblems('1 problem');
	await header.openProblems();
	await expect(page.getByRole('dialog', { name: 'Problems' })).toContainText('Another page took over as host.');
});

test('declining the replacement leaves the page standalone and the host alone', async ({ page, soundboard, splash }) => {
	await soundboard.open();
	await splash.choose('host');
	await soundboard.waitUntilLoaded();

	const second = await page.context().newPage();
	await second.goto(soundboard.url);
	await second.locator('[data-start-mode=host]').click();
	const dialog = second.getByRole('dialog', { name: 'Replace the host?' });
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(second.locator('[data-role-label]')).toBeHidden();
	await expect(roleLabel(page)).toBeVisible();
});

test('stopping hosting turns the page standalone and tells the remote', async ({ page, soundboard, splash }) => {
	await soundboard.open();
	await splash.choose('host');
	await soundboard.waitUntilLoaded();
	const remote = await page.context().newPage();
	await remote.goto(soundboard.url);
	await remote.locator('[data-start-mode=remote]').click();
	await expect(remote.locator('[data-host-status]')).toHaveText('Host connected');

	await page.locator('[data-app-menu]').click();
	await page.getByRole('menuitem', { name: 'Stop hosting' }).click();

	await expect(roleLabel(page)).toBeHidden();
	await expect(remote.locator('[data-host-status]')).toHaveText('No host');
	await expect(remote.locator('[data-remote-notice]')).toContainText('No host is connected');
});

test('a standalone page can become the host from its menu', async ({ page, soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
	await page.locator('[data-app-menu]').click();
	await page.getByRole('menuitem', { name: 'Become host' }).click();
	await expect(roleLabel(page)).toHaveText('Host');
});
