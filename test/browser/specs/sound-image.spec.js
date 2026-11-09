import { expect, test } from '../support/fixtures.js';
import { pngBytes } from '../../helpers/image-bytes.js';

const SOUND = 'Base Connected';
const FILE = 'Sound MP3 with title tag.mp3';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('the sound dialog opens on its Sound tab, and the Image tab gives the tile an image', async ({ sounds, dialogs, disk }) => {
	await test.step('Open the dialog: the Sound tab shows the title', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.expectTitle(SOUND);
	});

	await test.step('Open the Image tab: no image, so the sliders and Remove are off', async () => {
		await dialogs.soundEditor.openImageTab();
		await dialogs.soundEditor.expectPreviewImage(false);
		await dialogs.soundEditor.expectImageSlidersEnabled(false);
		await dialogs.soundEditor.expectRemoveEnabled(false);
	});

	await test.step('Choose a PNG file', async () => {
		await dialogs.soundEditor.chooseImageFile('cover.png', 'image/png', pngBytes(640, 360));
	});

	await test.step('It is stored next to the sound, and the tile and the preview show it', async () => {
		await disk.expectFile(`${FILE}.bg.png`);
		await sounds.expectImage(SOUND, true);
		await dialogs.soundEditor.expectPreviewImage(true);
		await dialogs.soundEditor.expectImageSlidersEnabled(true);
	});

	await test.step('Remove it', async () => {
		await dialogs.soundEditor.removeImage();
	});

	await test.step('The file is gone and the tile is plain again', async () => {
		await disk.expectNoFile(`${FILE}.bg.png`);
		await sounds.expectImage(SOUND, false);
	});
});

test('the sliders change the sound tile live and are saved with the sound', async ({ sounds, dialogs, disk, audio }) => {
	await test.step('Give the sound an image', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.openImageTab();
		await dialogs.soundEditor.chooseImageFile('cover.png', 'image/png', pngBytes(64, 64));
		await dialogs.soundEditor.expectImageSlidersEnabled(true);
	});

	await test.step('Move the color slider', async () => {
		await dialogs.soundEditor.setImageSlider('imageColorOpacity', '0.25');
	});

	await test.step('The preview follows at once, and half a second later it is on disk', async () => {
		await dialogs.soundEditor.expectPreviewColorOpacity('0.25');
		await audio.advance(500);
		await disk.expectOptions(FILE, { imageColorOpacity: 0.25 });
	});
});

test("a remote control shows the sound's image on its button", async ({ page, soundboard, sounds, dialogs }) => {
	await test.step('Become the host and give the sound an image', async () => {
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: 'Become host' }).click();
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.openImageTab();
		await dialogs.soundEditor.chooseImageFile('cover.png', 'image/png', pngBytes(64, 64));
		await sounds.expectImage(SOUND, true);
	});

	const remote = await page.context().newPage();
	await test.step('Open a remote control', async () => {
		await remote.goto(soundboard.url);
		await remote.locator('[data-start-mode=remote]').click();
		await expect(remote.locator('[data-remote-view]')).toBeVisible();
	});

	await test.step("Its button has the image, from the remote's own route", async () => {
		const button = remote.locator(`[data-sound-id="${FILE}"]`);
		await expect(button).toHaveAttribute('data-image', 'true');
		await expect(button.locator('[data-tile-image]')).toHaveAttribute('data-url', /^\/api\/remote\/sound-backgrounds\/Sound%20MP3%20with%20title%20tag\.mp3\?v=/);
	});
});
