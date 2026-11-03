import { expect, test } from '../support/fixtures.js';

/** The header's role label (DESIGN.md §9.15): "Host" or "Remote control", and none for a standalone page. */
const roleLabel = (/** @type {import('@playwright/test').Page} */ page) => page.locator('[data-role-label]');

test('the splash offers three ways to start', async ({ page, soundboard, splash }) => {
	await test.step('Open the page', async () => {
		await soundboard.open();
		await splash.expectVisible();
	});

	await test.step('The splash has three start buttons and says no host is running', async () => {
		await expect(page.locator('[data-start-mode]')).toHaveCount(3);
		await expect(page.locator('[data-remote-note]')).toHaveText('No host is running yet. It will work once one starts.');
	});

	await test.step('It has no app name, and the empty host note still keeps its space', async () => {
		await expect(page.locator('[data-splash] h1')).toBeHidden();
		await expect(page.locator('[data-host-note]')).toHaveText('');
		const box = await page.locator('[data-host-note]').boundingBox();
		expect(box?.height).toBeGreaterThan(0);
	});
});

test('a standalone page is not a host, and its menu offers to become one', async ({ page, soundboard }) => {
	await test.step('Start the page normally', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('It has no role label', async () => {
		await expect(roleLabel(page)).toBeHidden();
	});

	await test.step('Its menu offers Become host', async () => {
		await page.locator('[data-app-menu]').click();
		await expect(page.getByRole('menuitem', { name: 'Become host' })).toBeVisible();
	});
});

test('choosing Host makes the page the host at once', async ({ page, soundboard, splash }) => {
	await test.step('Choose Host on the splash', async () => {
		await soundboard.open();
		await splash.choose('host');
		await soundboard.waitUntilLoaded();
	});

	await test.step('The header says Host', async () => {
		await expect(roleLabel(page)).toBeVisible();
		await expect(roleLabel(page)).toHaveText('Host');
		await expect(page.locator('header[data-role]')).toHaveAttribute('data-role', 'host');
	});

	await test.step('The menu offers Stop hosting', async () => {
		await page.locator('[data-app-menu]').click();
		await expect(page.getByRole('menuitem', { name: 'Stop hosting' })).toBeVisible();
	});
});

test('a remote control follows the host and controls it', async ({ page, soundboard, splash, footer }) => {
	await test.step('Start the first page as the host', async () => {
		await soundboard.open();
		await splash.choose('host');
		await soundboard.waitUntilLoaded();
	});

	const remote = await page.context().newPage();

	await test.step('Open a second page: it knows another page is the host', async () => {
		await remote.goto(soundboard.url);
		await expect(remote.locator('[data-host-note]')).toHaveText('Another page is the host. You will be asked before it is replaced.');
	});

	await test.step('Start it as a remote control: it is connected to the host', async () => {
		await remote.locator('[data-start-mode=remote]').click();
		await expect(remote.locator('[data-remote-view]')).toBeVisible();
		await expect(roleLabel(remote)).toHaveText('Remote');
		await expect(remote.locator('[data-host-status]')).toHaveAttribute('title', 'Host connected');
	});

	await test.step('Start a playlist from the remote: the host plays it and the remote shows it', async () => {
		await remote.locator('[data-playlist-id="Music MP3"]').click();
		await footer.expectPlayersCount(1);
		await expect(remote.locator('[data-remote-player="Music MP3"]')).toBeVisible();
		await expect(remote.locator('[data-remote-player="Music MP3"] [data-player-track]')).toHaveText('Piece by Piece');
		await expect(remote.locator('[data-playlist-id="Music MP3"]')).toHaveAttribute('data-active', 'true');
	});

	await test.step('Press Next on the remote: the track changes', async () => {
		await remote.getByRole('button', { name: 'Next', exact: true }).click();
		await expect(remote.locator('[data-remote-player="Music MP3"] [data-player-track]')).not.toHaveText('Piece by Piece');
	});

	await test.step('Press a sound twice on the remote: it plays, then stops', async () => {
		await remote.locator('[data-sound-id]').first().click();
		await expect(remote.locator('[data-sound-id][data-active="true"]')).toHaveCount(1);
		await remote.locator('[data-sound-id]').first().click();
		await expect(remote.locator('[data-sound-id][data-active="true"]')).toHaveCount(0);
	});

	await test.step('Press Stop on the remote, then start the playlist again', async () => {
		await remote.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(remote.locator('[data-remote-player]')).toHaveCount(0);
		await remote.locator('[data-playlist-id="Music MP3"]').click();
		await footer.expectPlayersCount(1);
	});

	await test.step('Press the panic button on the remote: everything stops', async () => {
		await remote.locator('[data-panic-button]').click();
		await footer.expectEmpty();
		await expect(remote.locator('[data-remote-player]')).toHaveCount(0);
	});
});

test('a remote control with no host shows a notice, and never touches the audio', async ({ page, soundboard }) => {
	/** @type {string[]} */
	const media = [];

	await test.step('Open the page and record media requests', async () => {
		await soundboard.open();
		page.on('request', (request) => request.url().includes('/media/') && media.push(request.url()));
	});

	await test.step('Start it as a remote control', async () => {
		await page.locator('[data-start-mode=remote]').click();
		await expect(page.locator('[data-remote-view]')).toBeVisible();
	});

	await test.step('It says there is no host and offers no controls', async () => {
		await expect(page.locator('[data-remote-notice]')).toContainText('No host is connected');
		await expect(page.locator('button[data-remote-action]')).toHaveCount(0);
	});

	await test.step('It asked for no media and did not even unlock the audio', async () => {
		expect(media).toEqual([]);
		expect(await page.evaluate(() => globalThis.soundboardTest.engine.unlockCount)).toBe(0);
	});
});

test('a second host must be confirmed by holding, and the first one becomes standalone with an error', async ({ page, soundboard, splash, header }) => {
	await test.step('Start the first page as the host', async () => {
		await soundboard.open();
		await splash.choose('host');
		await soundboard.waitUntilLoaded();
	});

	const second = await page.context().newPage();
	const dialog = second.getByRole('dialog', { name: 'Replace the host?' });

	await test.step('Choose Host on a second page: it asks whether to replace the host', async () => {
		await second.goto(soundboard.url);
		await second.locator('[data-start-mode=host]').click();
		await expect(dialog).toBeVisible();
		await expect(second.locator('[data-role-label]')).toBeHidden();
	});

	await test.step('A short press does nothing', async () => {
		await dialog.locator('[data-replace-host]').click();
		await expect(dialog).toBeVisible();
	});

	await test.step('Holding the button replaces the host', async () => {
		await dialog.locator('[data-replace-host]').click({ delay: 1200 });
		await expect(dialog).toBeHidden();
		await expect(second.locator('[data-role-label]')).toHaveText('Host');
	});

	await test.step('The first page is standalone and lists the takeover as a problem', async () => {
		await expect(roleLabel(page)).toBeHidden();
		await header.expectProblems('1 problem');
		await header.openProblems();
		await expect(page.getByRole('dialog', { name: 'Problems' })).toContainText('Another page took over as host.');
	});
});

test('declining the replacement leaves the page standalone and the host alone', async ({ page, soundboard, splash }) => {
	await test.step('Start the first page as the host', async () => {
		await soundboard.open();
		await splash.choose('host');
		await soundboard.waitUntilLoaded();
	});

	const second = await page.context().newPage();
	const dialog = second.getByRole('dialog', { name: 'Replace the host?' });

	await test.step('Choose Host on a second page and click Cancel', async () => {
		await second.goto(soundboard.url);
		await second.locator('[data-start-mode=host]').click();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
	});

	await test.step('The second page is standalone and the first is still the host', async () => {
		await expect(dialog).toBeHidden();
		await expect(second.locator('[data-role-label]')).toBeHidden();
		await expect(roleLabel(page)).toBeVisible();
	});
});

test('stopping hosting turns the page standalone and tells the remote', async ({ page, soundboard, splash }) => {
	await test.step('Start the first page as the host', async () => {
		await soundboard.open();
		await splash.choose('host');
		await soundboard.waitUntilLoaded();
	});

	const remote = await page.context().newPage();

	await test.step('Connect a remote control', async () => {
		await remote.goto(soundboard.url);
		await remote.locator('[data-start-mode=remote]').click();
		await expect(remote.locator('[data-host-status]')).toHaveAttribute('title', 'Host connected');
	});

	await test.step("Choose Stop hosting in the host's menu", async () => {
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: 'Stop hosting' }).click();
	});

	await test.step('The host is standalone and the remote says there is no host', async () => {
		await expect(roleLabel(page)).toBeHidden();
		await expect(remote.locator('[data-host-status]')).toHaveAttribute('title', 'No host');
		await expect(remote.locator('[data-remote-notice]')).toContainText('No host is connected');
	});
});

test('a standalone page can become the host from its menu', async ({ page, soundboard }) => {
	await test.step('Start the page normally', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('Choose Become host in the menu', async () => {
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: 'Become host' }).click();
	});

	await test.step('The header says Host', async () => {
		await expect(roleLabel(page)).toHaveText('Host');
	});
});
