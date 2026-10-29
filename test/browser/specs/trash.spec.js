import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test('there is no trash button while the trash is empty', async ({ header }) => {
	await header.expectNoTrash();
});

test('deleting a sound takes its tile away and puts it in the trash', async ({ sounds, dialogs, header }) => {
	await sounds.useMenu('Base Connected', 'Customize');

	await dialogs.soundEditor.holdToDelete();

	await dialogs.soundEditor.expectClosed();
	await sounds.expectGone('Base Connected');
	await header.expectTrash('0.1 MB');
});

test('a deleted sound can be restored from the trash', async ({ sounds, dialogs, header }) => {
	await sounds.useMenu('Base Connected', 'Customize');
	await dialogs.soundEditor.holdToDelete();
	await sounds.expectGone('Base Connected');

	await header.openTrash();
	await dialogs.trash.expectHolding('Base Connected');
	await dialogs.trash.restore('Base Connected');

	await dialogs.trash.expectClosed();
	await sounds.expectShown('Base Connected');
	await header.expectNoTrash();
});

test('a click on Delete in the trash does nothing until the button is held', async ({ sounds, dialogs, header }) => {
	await sounds.useMenu('Base Connected', 'Customize');
	await dialogs.soundEditor.holdToDelete();
	await header.openTrash();

	await dialogs.trash.deleteForever('Base Connected');

	await dialogs.trash.expectClosed();
	await header.expectNoTrash();
	await sounds.expectGone('Base Connected');
});
