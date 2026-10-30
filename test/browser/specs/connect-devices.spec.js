import { expect, test } from '../support/fixtures.js';

/**
 * What a phone does, from the test: the server counts this machine's address as the device (a real phone has its own).
 * @param {string} url
 * @param {string} path
 * @param {'GET' | 'POST'} [method]
 */
async function asDevice(url, path, method = 'POST') {
	const response = await fetch(url + path, { method });
	return response.json();
}

test.describe('with --lan', () => {
	test.use({ lan: true });

	test('a pairing request shows as a card with its code, and Allow answers it', async ({ page, soundboard }) => {
		await test.step('Open the page: no request is shown', async () => {
			await soundboard.startAndWaitUntilLoaded();
			await expect(page.locator('[data-access-requests]')).toBeHidden();
		});

		const card = page.locator('[data-access-request]');
		const { code } = await test.step('A device asks to pair', async () => {
			return asDevice(soundboard.url, '/api/access/requests');
		});

		await test.step('A card shows the code and the device address', async () => {
			await expect(card).toHaveCount(1);
			await expect(card.locator('[data-access-code]')).toHaveText(code);
			await expect(card).toContainText('127.0.0.1');
		});

		await test.step('Click Allow', async () => {
			await card.locator('[data-access-decision=allow]').click();
		});

		await test.step('The card goes and the device is told it is allowed', async () => {
			await expect(page.locator('[data-access-request]')).toHaveCount(0);
			expect(await asDevice(soundboard.url, '/api/access/requests/mine', 'GET')).toEqual({ status: 'allowed', code });
		});
	});

	test('Deny answers the request too', async ({ page, soundboard }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});

		const { code } = await test.step('A device asks to pair', async () => {
			return asDevice(soundboard.url, '/api/access/requests');
		});

		await test.step('Click Deny', async () => {
			await page.locator('[data-access-decision=deny]').click();
		});

		await test.step('The card goes and the device is told it is denied', async () => {
			await expect(page.locator('[data-access-request]')).toHaveCount(0);
			expect(await asDevice(soundboard.url, '/api/access/requests/mine', 'GET')).toEqual({ status: 'denied', code });
		});
	});

	test('a request made before the page opened is shown at once, and asking again keeps the code', async ({ page, soundboard }) => {
		const { code } = await test.step('A device asks to pair before the page is open', async () => {
			return asDevice(soundboard.url, '/api/access/requests');
		});

		await test.step('Asking again returns the same code', async () => {
			expect(await asDevice(soundboard.url, '/api/access/requests')).toEqual({ status: 'pending', code });
		});

		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});

		await test.step('The request is already there with its code', async () => {
			await expect(page.locator('[data-access-request]')).toHaveCount(1);
			await expect(page.locator('[data-access-code]')).toHaveText(code);
		});
	});

	test('the menu shows a QR code with the address to open on a phone', async ({ page, soundboard }) => {
		await test.step('Open the page', async () => {
			await soundboard.startAndWaitUntilLoaded();
		});

		await test.step('Choose Connect a phone in the menu', async () => {
			await page.locator('[data-app-menu]').click();
			await page.getByRole('menuitem', { name: 'Connect a phone' }).click();
		});

		await test.step('The dialog shows a QR code and the address', async () => {
			const dialog = page.locator('[data-connect-phone]');
			await expect(dialog.locator('canvas[data-qr-code]')).toBeVisible();
			const port = new URL(soundboard.url).port;
			await expect(dialog.locator('[data-connect-link]')).toHaveText(`http://192.168.1.20:${port}/`);
		});
	});

	test('the connect page shows the code of the pending request, which asking again returns', async ({ page, soundboard }) => {
		await test.step('Open the connect page by name, since this machine is trusted and never gets it by itself', async () => {
			await page.goto(`${soundboard.url}/connect.html`);
		});

		const code = await test.step('It shows a pending request with a three-digit code', async () => {
			await expect(page.locator('[data-pairing-status]')).toHaveAttribute('data-pairing-status', 'pending');
			const shown = await page.locator('[data-pairing-code]').innerText();
			expect(shown).toMatch(/^\d{3}$/);
			return shown;
		});

		await test.step('Asking again returns the same code', async () => {
			expect(await asDevice(soundboard.url, '/api/access/requests')).toEqual({ status: 'pending', code });
		});
	});
});

test('without --lan, the menu says how to connect a phone', async ({ page, soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});

	await test.step('Choose Connect a phone in the menu', async () => {
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: 'Connect a phone' }).click();
	});

	await test.step('The dialog mentions --lan and shows no QR code', async () => {
		await expect(page.locator('[data-connect-phone]')).toContainText('--lan');
		await expect(page.locator('[data-qr-code]')).toHaveCount(0);
	});
});
