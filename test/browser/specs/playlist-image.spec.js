import { createServer } from 'node:http';
import { expect, test } from '../support/fixtures.js';
import { gifBytes, jpegBytes, pngBytes } from '../../helpers/image-bytes.js';

const PLAYLIST = 'Music MP3';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('an uploaded image shows on the tile and the preview, and Remove takes it away', async ({ playlists, dialogs, disk }) => {
	await test.step('Open the Image tab: no image, so the sliders and Remove are off', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openImageTab();
		await dialogs.playlistEditor.expectPreviewImage(false);
		await dialogs.playlistEditor.expectImageSlidersEnabled(false);
		await dialogs.playlistEditor.expectRemoveEnabled(false);
	});

	await test.step('Choose a PNG file', async () => {
		await dialogs.playlistEditor.chooseImageFile('cover.png', 'image/png', pngBytes(640, 360));
	});

	await test.step('It is stored, and the tile, the preview and the sliders follow', async () => {
		await disk.expectFile(`${PLAYLIST}.bg.png`);
		await playlists.expectImage(PLAYLIST, true);
		await dialogs.playlistEditor.expectPreviewImage(true);
		await dialogs.playlistEditor.expectImageSlidersEnabled(true);
		await dialogs.playlistEditor.expectRemoveEnabled(true);
		await dialogs.playlistEditor.expectLargeImageNote(false);
	});

	await test.step('Remove it', async () => {
		await dialogs.playlistEditor.removeImage();
	});

	await test.step('The file is gone and the tile is plain again', async () => {
		await disk.expectNoFile(`${PLAYLIST}.bg.png`);
		await playlists.expectImage(PLAYLIST, false);
		await dialogs.playlistEditor.expectImageSlidersEnabled(false);
	});
});

test('a refused file says why and stores nothing', async ({ playlists, dialogs, disk }) => {
	await test.step('Choose a JPEG named as a PNG', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openImageTab();
		await dialogs.playlistEditor.chooseImageFile('cover.png', 'image/png', jpegBytes(10, 10));
	});

	await test.step('The tab names both formats, and nothing is stored', async () => {
		await dialogs.playlistEditor.expectImageError('This file says it is a PNG but is a JPEG.');
		await disk.expectNoFile(`${PLAYLIST}.bg.png`);
		await playlists.expectImage(PLAYLIST, false);
	});
});

test('an image larger than 1080p is shown with a note', async ({ playlists, dialogs }) => {
	await test.step('Choose a 4000 × 3000 image', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openImageTab();
		await dialogs.playlistEditor.chooseImageFile('big.png', 'image/png', pngBytes(4000, 3000));
	});

	await test.step('It shows, with the yellow note under the source', async () => {
		await playlists.expectImage(PLAYLIST, true);
		await dialogs.playlistEditor.expectLargeImageNote(true);
	});
});

test("a link is downloaded into the playlist's image", async ({ playlists, dialogs, disk }) => {
	const images = createServer((_incoming, outgoing) => {
		const bytes = gifBytes(32, 32);
		outgoing.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': bytes.length }).end(bytes);
	});
	await new Promise((resolve) => images.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (images.address());

	try {
		await test.step('Paste a link and press Enter', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.openImageTab();
			await dialogs.playlistEditor.downloadImage(`http://127.0.0.1:${port}/cover`);
		});

		await test.step('The image is stored under the format its bytes have, and shows', async () => {
			await disk.expectFile(`${PLAYLIST}.bg.gif`);
			await playlists.expectImage(PLAYLIST, true);
		});
	} finally {
		await new Promise((resolve) => images.close(resolve));
	}
});

test('the sliders change the tile live and are saved', async ({ playlists, dialogs, disk, audio }) => {
	await test.step('Give the playlist an image', async () => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openImageTab();
		await dialogs.playlistEditor.chooseImageFile('cover.png', 'image/png', pngBytes(64, 64));
		await dialogs.playlistEditor.expectImageSlidersEnabled(true);
	});

	await test.step('Move the color and shadow sliders', async () => {
		await dialogs.playlistEditor.setImageSlider('imageColorOpacity', '0.25');
		await dialogs.playlistEditor.setImageSlider('titleShadowOffset', '3');
	});

	await test.step('The preview follows at once', async () => {
		await dialogs.playlistEditor.expectPreviewColorOpacity('0.25');
	});

	await test.step('Half a second later they are on disk', async () => {
		await audio.advance(500);
		await disk.expectOptions(PLAYLIST, { imageColorOpacity: 0.25, titleShadowOffset: 3 });
	});
});

test("a remote control shows the playlist's image on its button", async ({ page, soundboard, playlists, dialogs }) => {
	await test.step('Become the host and give the playlist an image', async () => {
		await page.locator('[data-app-menu]').click();
		await page.getByRole('menuitem', { name: 'Become host' }).click();
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openImageTab();
		await dialogs.playlistEditor.chooseImageFile('cover.png', 'image/png', pngBytes(64, 64));
		await playlists.expectImage(PLAYLIST, true);
	});

	const remote = await page.context().newPage();
	await test.step('Open a remote control', async () => {
		await remote.goto(soundboard.url);
		await remote.locator('[data-start-mode=remote]').click();
		await expect(remote.locator('[data-remote-view]')).toBeVisible();
	});

	await test.step("Its button has the image, from the remote's own route", async () => {
		const button = remote.locator(`[data-playlist-id="${PLAYLIST}"]`);
		await expect(button).toHaveAttribute('data-image', 'true');
		await expect(button.locator('[data-tile-image]')).toHaveAttribute('data-url', /^\/api\/remote\/backgrounds\/Music%20MP3\?v=/);
	});
});
