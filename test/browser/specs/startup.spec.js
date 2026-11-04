import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import { startApp } from '../support/app.js';

/** @type {import('@playwright/test').Fixtures<{ app: Awaited<ReturnType<typeof startApp>>, args: string[] }, {}, import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions>} */
const fixtures = {
	// The command-line arguments after `--no-open` and the port; `<home>` stands for the home folder.
	args: [[], { option: true }],
	app: async ({ args }, use) => {
		const app = await startApp(args);
		await use(app);
		await app.stop();
	},
};
const test = base.extend(fixtures);
const { version: VERSION } = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8'));

/**
 * Holds a hold button down until it acts (DESIGN.md §9.7).
 * @param {import('@playwright/test').Locator} button
 */
async function hold(button) {
	await button.hover();
	await button.page().mouse.down();
	await button.page().waitForTimeout(1200);
	await button.page().mouse.up();
}

test.describe('the Selector', () => {
	test('browses the home folder, opens a new soundboard through the Initializer, and comes back with Change soundboard', async ({ page, app }) => {
		await test.step('The Selector shows the home folder with Board in it', async () => {
			await page.goto(app.url);
			await expect(page.locator(`[data-folder="${app.board}"]`)).toBeVisible();
			await expect(page.locator(`[data-folder="${app.board}"]`)).toContainText('📁');
			await expect(page.locator('[data-folder-summary]')).toHaveText('Choose a folder inside this one.');
			await expect(page.locator('[data-folder-open]')).toBeDisabled();
			await expect(page.locator('[data-browse-back]')).toBeHidden();
			await expect(page.locator('[data-tool=ffmpeg]')).toContainText('not installed');
			await expect(page.getByRole('heading', { name: 'TTRPG Soundboard' })).toBeVisible();
			await expect(page.locator('[data-app-version]')).toHaveText(`v${VERSION}`);
		});

		await test.step('Go into Board: it isn’t a soundboard yet', async () => {
			await page.locator(`[data-folder="${app.board}"] button`).first().click();
			await expect(page.locator('[data-path-input]')).toHaveValue(app.board);
			await expect(page.locator('[data-folder-summary]')).toHaveText('4 folders, 4 audio files');
			await expect(page.locator('[data-folder-open]')).toHaveText('Create soundboard here');
		});

		await test.step('Create it: the Initializer asks about the titles in the tags', async () => {
			await page.locator('[data-folder-open]').click();
			await expect(page.locator('[data-initializer-step=question]')).toContainText('These files have titles in their tags');
			await expect(page.locator('[data-initializer-step=question] li').first()).toBeVisible();
		});

		await test.step('Use the titles: the soundboard opens', async () => {
			await page.locator('[data-answer=yes]').click();
			await page.locator('[data-start-mode=standalone]').click();
			await expect(page.locator('[data-app-menu]')).toBeVisible();
		});

		await test.step('Change soundboard: back in the Selector, showing Board as a recent folder and not the browser', async () => {
			await page.locator('[data-app-menu]').click();
			await page.getByText('Change soundboard').click();
			await expect(page.locator(`[data-folder-card="${app.board}"]`)).toBeVisible();
			await expect(page.locator('[data-folder-list]')).toBeHidden();
		});

		await test.step('Browse folders… swaps the recent folders for the browser, back in Board where it was left', async () => {
			await page.locator('[data-browse]').click();
			await expect(page.locator('[data-folder-list]')).toBeVisible();
			await expect(page.locator(`[data-folder-card="${app.board}"]`)).toBeHidden();
			await expect(page.locator('[data-path-input]')).toHaveValue(app.board);
		});

		await test.step('Up to the home folder: Board is a soundboard now, and ← Recent swaps the recent folders back', async () => {
			await page.locator('[data-folder-up]').click();
			await expect(page.locator('[data-path-input]')).toHaveValue(app.home);
			const board = page.locator(`[data-folder="${app.board}"]`);
			await expect(board).toContainText('🗂️');
			await expect(board.locator('button')).toHaveCount(1);
			await expect(board.locator('[data-folder-quick-open]')).toBeVisible();
			await page.locator('[data-browse-back]').click();
			await expect(page.locator('[data-folder-list]')).toBeHidden();
			await expect(page.locator(`[data-folder-card="${app.board}"]`)).toBeVisible();
		});

		await test.step('Open it again from the card: it is a soundboard now, so nothing is asked', async () => {
			await page.locator(`[data-folder-card="${app.board}"] button`).first().click();
			await expect(page.locator('[data-start-mode=standalone]')).toBeVisible();
		});
	});

	test('a folder that isn’t allowed shows a notice in the corner and the path goes back', async ({ page, app }) => {
		await page.goto(app.url);
		await expect(page.locator('[data-path-input]')).toHaveValue(app.home);
		const toast = page.locator('[data-toast]');

		await test.step('Type a folder outside the home folder', async () => {
			await page.locator('[data-path-input]').fill('/');
			await page.locator('[data-path-input]').press('Enter');
			await expect(toast).toHaveAttribute('data-visible', 'true');
			await expect(toast).toHaveText('This folder is outside the folders the app may open.');
			await expect(page.locator('[data-path-input]')).toHaveValue(app.home);
		});

		await test.step('The notice fades by itself', async () => {
			await expect(toast).toHaveAttribute('data-visible', 'false', { timeout: 3000 });
		});

		await test.step('Up from the home folder gets the same notice', async () => {
			await page.locator('[data-folder-up]').click();
			await expect(toast).toHaveAttribute('data-visible', 'true');
			await expect(page.locator('[data-path-input]')).toHaveValue(app.home);
		});

		await test.step('A hidden folder gets its own reason', async () => {
			await mkdir(join(app.home, '.hidden'));
			await page.locator('[data-path-input]').fill(join(app.home, '.hidden'));
			await page.locator('[data-path-input]').press('Enter');
			await expect(toast).toHaveText('Hidden folders can’t be used.');
		});
	});

	test('lists the audio files, a soundboard’s own name after its folder’s, and the folders with a soundboard inside', async ({ page, app }) => {
		await mkdir(join(app.home, 'tavern', 'Combat'), { recursive: true });
		await writeFile(join(app.home, 'tavern', '.soundboard'), JSON.stringify({ version: 1, name: 'Tavern night' }));
		await mkdir(join(app.home, 'same'));
		await writeFile(join(app.home, 'same', '.soundboard'), JSON.stringify({ version: 1, name: 'same' }));
		await mkdir(join(app.home, 'Campaigns', 'Old', 'board'), { recursive: true });
		await writeFile(join(app.home, 'Campaigns', 'Old', 'board', '.soundboard'), '{ "version": 1 }');
		await writeFile(join(app.home, 'Theme.mp3'), '');
		await page.goto(app.url);

		await test.step('A named soundboard shows its folder’s name, then its own in parentheses, unless they match', async () => {
			const tavern = page.locator(`[data-folder="${join(app.home, 'tavern')}"]`);
			await expect(tavern).toContainText('🗂️tavern');
			await expect(tavern.locator('[data-folder-title]')).toHaveText('(Tavern night)');
			await expect(page.locator(`[data-folder="${join(app.home, 'same')}"] [data-folder-title]`)).toHaveCount(0);
		});

		await test.step('A folder with a soundboard two levels inside gets the mark; Board, a level of audio only, doesn’t', async () => {
			await expect(page.locator(`[data-folder="${join(app.home, 'Campaigns')}"] [data-holds-soundboard]`)).toHaveAttribute('title', 'A soundboard is somewhere inside this folder');
			await expect(page.locator(`[data-folder="${app.board}"] [data-holds-soundboard]`)).toHaveCount(0);
		});

		await test.step('The audio files follow the folders and can’t be clicked', async () => {
			const file = page.locator('[data-audio-file="Theme.mp3"]');
			await expect(file).toHaveText('🎵Theme.mp3');
			await expect(file.locator('button')).toHaveCount(0);
			await expect(page.locator('[data-folder-list] > li').last()).toHaveAttribute('data-audio-file', 'Theme.mp3');
		});
	});

	test('goes to a place picked from the Places menu, which closes on a pick or Esc', async ({ page, app }) => {
		await page.goto(app.url);
		const menu = page.locator('[data-places-menu]');
		const home = page.locator('[data-place]').first();

		await test.step('In the home folder, Home is the first place and marked as the one shown', async () => {
			await expect(page.locator('[data-path-input]')).toHaveValue(app.home);
			await expect(menu).toBeHidden();
			await page.locator('[data-places-button]').click();
			await expect(home).toHaveText('Home');
			await expect(home).toHaveAttribute('data-current', 'true');
		});

		await test.step('Esc closes the menu', async () => {
			await page.keyboard.press('Escape');
			await expect(menu).toBeHidden();
		});

		await test.step('From Board, picking Home goes back there and closes the menu', async () => {
			await page.locator(`[data-folder="${app.board}"] button`).first().click();
			await expect(page.locator('[data-path-input]')).toHaveValue(app.board);
			await page.locator('[data-places-button]').click();
			await expect(home).toHaveAttribute('data-current', 'false');
			await home.click();
			await expect(menu).toBeHidden();
			await expect(page.locator('[data-path-input]')).toHaveValue(app.home);
		});
	});

	test('forgets a recent folder with its ×', async ({ page, app }) => {
		await page.goto(app.url);
		// The first folder fills the path field in when it comes, which must not land in the middle of typing.
		await expect(page.locator('[data-folder-summary]')).toBeVisible();
		await page.locator('[data-path-input]').fill(app.board);
		await page.locator('[data-path-input]').press('Enter');
		await page.locator('[data-folder-open]').click();
		await page.locator('[data-answer=no]').click();
		// Straight from the splash, before choosing how to start.
		await expect(page.locator('[data-start-mode=standalone]')).toBeVisible();
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: 'Change soundboard' }).click();
		await page.locator(`[data-forget="${app.board}"]`).click();
		await expect(page.locator('[data-folder-card]')).toHaveCount(0);
		await expect(page.locator('[data-browse]')).toBeEnabled();
	});
});

test.describe('with folders given on the command line', () => {
	test.use({ args: ['<home>/Board', '<home>', '<home>/Missing'] });

	test('offers only those, the refused ones greyed out with their reason as the tooltip', async ({ page, app }) => {
		await page.goto(app.url);
		const cards = page.locator('[data-folder-card]');
		await expect(cards).toHaveCount(3);
		await expect(page.locator('[data-folder-list]')).toBeHidden();
		await expect(page.locator('[data-browse]')).toBeDisabled();
		await expect(page.locator('[data-browse]').locator('..')).toHaveAttribute('title', 'Only the folders given when the app was started can be opened.');
		await expect(page.locator(`[data-folder-card="${app.home}"]`)).toHaveAttribute('data-refused', 'true');
		await expect(page.locator(`[data-folder-card="${app.home}"]`)).toHaveAttribute('title', 'Choose a folder inside this one.');
		await expect(page.locator(`[data-folder-card="${join(app.home, 'Missing')}"]`)).toHaveAttribute('title', 'This folder doesn’t exist.');
		await expect(page.locator(`[data-folder-card="${app.board}"]`)).toHaveAttribute('data-refused', 'false');
		await page.locator(`[data-folder-card="${app.board}"] button`).click();
		await expect(page.locator('[data-initializer-step=question]')).toBeVisible();
	});
});

test.describe('the Initializer', () => {
	test.use({ args: ['<home>/Board'] });

	test('lists a broken options file, goes back, and deletes it when the button is held', async ({ page, app }) => {
		await writeFile(join(app.board, 'Music Mix.json'), '{broken');

		await test.step('Choose the folder: the broken file is listed', async () => {
			await page.goto(app.url);
			await page.locator(`[data-folder-card="${app.board}"] button`).click();
			await expect(page.locator('[data-initializer-step=failed]')).toBeVisible();
			await expect(page.locator('[data-startup-failure="Music Mix.json"]')).toContainText('invalid JSON');
		});

		await test.step('Back returns to the Selector, and choosing again fails the same way', async () => {
			await page.locator('[data-startup-action=back]').click();
			await page.locator(`[data-folder-card="${app.board}"] button`).click();
			await expect(page.locator('[data-initializer-step=failed]')).toBeVisible();
		});

		await test.step('Hold the delete button: the file goes, and the folder loads with its questions', async () => {
			await hold(page.locator('[data-hold-button]'));
			await expect(page.locator('[data-initializer-step=question]')).toBeVisible();
			await page.locator('[data-answer=yes]').click();
			await expect(page.locator('[data-start-mode=standalone]')).toBeVisible();
		});
	});

	test('loads again on Try again once the file was fixed by hand', async ({ page, app }) => {
		const broken = join(app.board, 'Music Mix.json');
		await writeFile(broken, '{broken');
		await page.goto(app.url);
		await page.locator(`[data-folder-card="${app.board}"] button`).click();
		await expect(page.locator('[data-initializer-step=failed]')).toBeVisible();
		await writeFile(broken, JSON.stringify({ title: 'Music Mix' }));
		await page.locator('[data-startup-action=retry]').click();
		await expect(page.locator('[data-initializer-step=question]')).toBeVisible();
	});
});
