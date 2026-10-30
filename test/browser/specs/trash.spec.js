import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('there is no trash button while the trash is empty', async ({ header }) => {
	await test.step('The header has no trash button', async () => {
		await header.expectNoTrash();
	});
});

test('deleting a sound takes its tile away and puts it in the trash', async ({ sounds, dialogs, header }) => {
	await test.step("Open the sound's dialog", async () => {
		await sounds.useMenu('Base Connected', 'Customize');
	});

	await test.step('Hold Delete', async () => {
		await dialogs.soundEditor.holdToDelete();
	});

	await test.step('The dialog closes, the tile is gone and the trash shows its size', async () => {
		await dialogs.soundEditor.expectClosed();
		await sounds.expectGone('Base Connected');
		await header.expectTrash('0.1 MB');
	});
});

test('a deleted sound can be restored from the trash', async ({ sounds, dialogs, header }) => {
	await test.step('Delete the sound', async () => {
		await sounds.useMenu('Base Connected', 'Customize');
		await dialogs.soundEditor.holdToDelete();
		await sounds.expectGone('Base Connected');
	});

	await test.step('Open the trash: the sound is in it', async () => {
		await header.openTrash();
		await dialogs.trash.expectHolding('Base Connected');
	});

	await test.step('Restore it', async () => {
		await dialogs.trash.restore('Base Connected');
	});

	await test.step('The dialog closes, the tile is back and the trash is empty', async () => {
		await dialogs.trash.expectClosed();
		await sounds.expectShown('Base Connected');
		await header.expectNoTrash();
	});
});

test('holding Delete in the trash deletes the item for good', async ({ sounds, dialogs, header }) => {
	await test.step('Delete the sound and open the trash', async () => {
		await sounds.useMenu('Base Connected', 'Customize');
		await dialogs.soundEditor.holdToDelete();
		await header.openTrash();
	});

	await test.step('Hold Delete on the item', async () => {
		await dialogs.trash.deleteForever('Base Connected');
	});

	await test.step('The dialog closes, the trash is empty and the sound is gone', async () => {
		await dialogs.trash.expectClosed();
		await header.expectNoTrash();
		await sounds.expectGone('Base Connected');
	});
});

test('a quick press on Delete in the trash does nothing', async ({ sounds, dialogs, header }) => {
	await test.step('Delete the sound and open the trash', async () => {
		await sounds.useMenu('Base Connected', 'Customize');
		await dialogs.soundEditor.holdToDelete();
		await header.openTrash();
	});

	await test.step('Tap Delete on the item', async () => {
		await dialogs.trash.tapDelete('Base Connected');
	});

	await test.step('The sound is still in the trash', async () => {
		await dialogs.trash.expectHolding('Base Connected');
	});
});
