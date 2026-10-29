import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const app = await launch({ readyExpression: '!!document.querySelector("[data-splash]")' });
const { evaluate, click, key, sleep, screenshot, logs, send } = app;
const results = {};
const check = (name, ok, detail) => {
	results[name] = ok ? 'ok' : `FAIL ${JSON.stringify(detail)}`;
};
const q = (selector) => JSON.stringify(selector);
const text = (selector) => evaluate(`document.querySelector(${q(selector)})?.textContent ?? null`);
const attr = (selector, name) => evaluate(`document.querySelector(${q(selector)})?.getAttribute(${q(name)}) ?? null`);
const visible = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); return !!el && el.checkVisibility(); })()`);
const soundOrder = () => evaluate('[...document.querySelectorAll("[data-sound-id]")].map((el) => el.dataset.soundId)');
const options = async (name) => JSON.parse(await readFile(join(app.music, `${name}.json`), 'utf8'));
const trackBox = () => evaluate('(() => { const r = document.querySelector("[data-dialog] [data-gain-track]").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()');
const pointer = async (type, x, y, buttons, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount });
const typeText = async (value) => send('Input.insertText', { text: value });
const pressKey = async (keyName, code) => {
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: code });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: code });
};
const SOUND = 'Sound MP3 with title tag.mp3';

try {
	await click('[data-splash]');
	await sleep(800);
	const initialOrder = await soundOrder();

	await click(`[data-sound-id="${SOUND}"]`, 'right');
	await sleep(200);
	const customize = await evaluate('[...document.querySelectorAll("[data-menu-item]")].find((el) => el.textContent === "Customize")?.disabled');
	check('Customize is enabled in the sound menu', customize === false, customize);
	await click('[data-menu-item="customize"]');
	await sleep(300);
	check('dialog opens with the title focused', (await visible('[data-dialog]'))
	&& (await evaluate('document.activeElement?.hasAttribute("data-item-title") && document.activeElement.value')) === 'Base Connected', await evaluate('document.activeElement?.outerHTML'));
	check('menu closed when the dialog opened', (await evaluate('document.querySelectorAll("[data-overlay-backdrop]").length')) === 0, null);
	check('readout starts at 0.0 dB', (await text('[data-dialog] [data-gain-readout]')) === '0.0 dB', await text('[data-dialog] [data-gain-readout]'));
	await screenshot(join(SHOTS, '4-dialog.png'));

	let box = await trackBox();
	const y = box.top + box.height / 2;
	await pointer('mouseMoved', box.left + box.width * 0.375, y, 0);
	await pointer('mousePressed', box.left + box.width * 0.375, y, 1);
	await pointer('mouseReleased', box.left + box.width * 0.375, y, 0);
	await sleep(100);
	check('clicking halfway along the bars sets gain 0.5 (−6 dB)', (await text('[data-dialog] [data-gain-readout]')) === '−6.0 dB' && Math.abs(Number(await attr('[data-dialog] [data-gain-track]', 'aria-valuenow')) - 0.5) < 0.01, await text('[data-dialog] [data-gain-readout]'));

	await pointer('mousePressed', box.left + box.width * 0.2, y, 1);
	for (const share of [0.4, 0.6, 0.8, 0.95, 1.2]) {
		await pointer('mouseMoved', box.left + box.width * share, y, 1);
	}
	await pointer('mouseReleased', box.left + box.width * 1.2, y, 0);
	await sleep(100);
	check('dragging past the end reaches the maximum boost', (await text('[data-dialog] [data-gain-readout]')) === '+12.0 dB', await text('[data-dialog] [data-gain-readout]'));
	check('there is no textual distortion warning', !(await evaluate('document.querySelector("[data-dialog]").textContent.includes("distort")')), null);
	check('the readout turns orange above 0 dB', (await attr('[data-dialog] [data-gain-readout]', 'data-boost')) === 'true'
	&& (await evaluate('getComputedStyle(document.querySelector("[data-dialog] [data-gain-readout]")).color')) === 'rgb(255, 146, 43)', await evaluate('getComputedStyle(document.querySelector("[data-dialog] [data-gain-readout]")).color'));
	check('the widget is h-8 (32 px) tall', (await trackBox()).height === 32, await trackBox());
	const clip = await evaluate('document.querySelector("[data-dialog] [data-gain-track]").lastElementChild.style.clipPath');
	check('the lit layer is fully revealed at the maximum', clip === 'inset(0px 0% 0px 0px)' || clip === 'inset(0px 0%)' || clip === 'inset(0 0% 0 0)', clip);
	await screenshot(join(SHOTS, '5-dialog-boost.png'));
	await sleep(800);
	check('the gain is saved after the debounce', (await options(SOUND)).gain === 4, await options(SOUND));
	check('the status shows a checkmark once saved, without text', (await attr('[data-save-status]', 'data-state')) === 'saved'
	&& (await text('[data-save-status]')) === '' && (await attr('[data-save-status]', 'aria-label')) === 'Saved', await evaluate('document.querySelector("[data-save-status]").outerHTML'));
	await pointer('mousePressed', box.left + box.width * (0.75 - 0.01), y, 1);
	await pointer('mouseReleased', box.left + box.width * (0.75 - 0.01), y, 0);
	await sleep(50);
	check('the status shows a spinner while saving', (await attr('[data-save-status]', 'data-state')) === 'saving'
	&& (await evaluate('!!document.querySelector("[data-save-status] svg.animate-spin")')), null);
	check('no snapping just below the 100 % mark', (await text('[data-dialog] [data-gain-readout]')) !== '0.0 dB', await text('[data-dialog] [data-gain-readout]'));

	const middle = box.left + box.width * 0.3;
	await pointer('mousePressed', middle, y, 1, 1);
	await pointer('mouseReleased', middle, y, 0, 1);
	await pointer('mousePressed', middle, y, 1, 2);
	await pointer('mouseReleased', middle, y, 0, 2);
	await sleep(100);
	check('double-click resets to 0 dB', (await text('[data-dialog] [data-gain-readout]')) === '0.0 dB', await text('[data-dialog] [data-gain-readout]'));

	await click('[data-dialog] [data-gain-readout]');
	await sleep(100);
	check('clicking the readout shows a focused, selected field', (await evaluate('document.activeElement?.getAttribute("aria-label")')) === 'Volume in dB'
	&& (await evaluate('document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === document.activeElement.value.length')), await evaluate('document.activeElement?.outerHTML'));
	await typeText('-12');
	await pressKey('Enter', 13);
	await sleep(100);
	check('typing -12 and Enter sets −12.0 dB', (await text('[data-dialog] [data-gain-readout]')) === '−12.0 dB' && (await visible('[data-dialog] [data-gain-readout]')), await text('[data-dialog] [data-gain-readout]'));

	await click('[data-dialog] [data-gain-readout]');
	await typeText('loud');
	await pressKey('Enter', 13);
	await sleep(100);
	check('an invalid level keeps the field open and marked', (await attr('[data-dialog] [data-gain-control] input', 'data-invalid')) === 'true' && !(await visible('[data-dialog] [data-gain-readout]')), null);
	await key('Escape');
	await sleep(100);
	check('Esc in the field cancels the edit but keeps the dialog open', (await text('[data-dialog] [data-gain-readout]')) === '−12.0 dB' && (await visible('[data-dialog]')), null);

	await evaluate('document.querySelector("[data-dialog] [data-gain-track]").focus()');
	await pressKey('ArrowUp', 38);
	await sleep(50);
	check('ArrowUp raises by 1 dB', (await text('[data-dialog] [data-gain-readout]')) === '−11.0 dB', await text('[data-dialog] [data-gain-readout]'));
	await pressKey('Home', 36);
	await sleep(50);
	check('Home silences', (await text('[data-dialog] [data-gain-readout]')) === '−∞ dB', await text('[data-dialog] [data-gain-readout]'));
	await pressKey('End', 35);
	await sleep(50);

	await evaluate('document.querySelector("[data-item-title]").select()');
	await evaluate('document.querySelector("[data-item-title]").focus()');
	await typeText('Zzz Last');
	await sleep(100);
	check('the tile title changes while typing', (await text(`[data-sound-id="${SOUND}"]`)) === 'Zzz Last', await text(`[data-sound-id="${SOUND}"]`));
	check('the tile does not move while the dialog is open', JSON.stringify(await soundOrder()) === JSON.stringify(initialOrder), await soundOrder());

	await evaluate('(() => { const input = document.querySelector("[data-item-title]"); input.value = "   "; input.dispatchEvent(new Event("input")); })()');
	await sleep(100);
	check('an empty title is marked invalid and the tile keeps the last one', (await attr('[data-item-title]', 'aria-invalid')) === 'true'
	&& (await text(`[data-sound-id="${SOUND}"]`)) === 'Zzz Last', null);

	await click('[data-item-preview]');
	await sleep(400);
	check('the play button plays the sound and turns into Stop', (await text('[data-item-preview]'))?.trim() === 'Stop'
	&& (await attr(`[data-sound-id="${SOUND}"]`, 'data-active')) === 'true', await text('[data-item-preview]'));
	await click('[data-item-preview]');
	await sleep(200);
	check('Stop stops it', (await text('[data-item-preview]'))?.trim() === 'Play', await text('[data-item-preview]'));
	await screenshot(join(SHOTS, '6-dialog-renamed.png'));

	await key('Escape');
	await sleep(300);
	check('Esc closes the dialog', !(await visible('[data-dialog]')), null);
	check('the tile moves to its sorted place once the dialog closes', (await soundOrder()).at(-1) === SOUND, await soundOrder());
	const saved = await options(SOUND);
	check('closing saves at once: title and gain', saved.title === 'Zzz Last' && saved.gain === 4, saved);

	await click(`[data-sound-id="${SOUND}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(200);
	const backdrop = await evaluate('(() => { const r = document.querySelector("[data-dialog-backdrop]").getBoundingClientRect(); return { x: r.left + 10, y: r.top + 10 }; })()');
	await app.mouse(backdrop.x, backdrop.y);
	await sleep(200);
	check('a click on the backdrop closes the dialog without playing anything', !(await visible('[data-dialog]'))
	&& (await evaluate('[...document.querySelectorAll("[data-sound-id]")].every((el) => el.dataset.active === "false")')), null);

	const header = '[data-volume="master"] [data-gain-track]';
	check('header widgets have no boost section', (await evaluate(`document.querySelector(${q(header)}).querySelectorAll('.bg-boost').length`)) === 0, null);
	const master = await evaluate(`(() => { const r = document.querySelector(${q(header)}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
	await app.mouse(master.left + master.width * 0.5, master.top + master.height / 2);
	await sleep(100);
	check('header: halfway is slider 0.5, shown as its real gain, −12.0 dB', (await text('[data-volume="master"] [data-gain-readout]')) === '−12.0 dB', await text('[data-volume="master"] [data-gain-readout]'));
	await sleep(700);
	const settings = JSON.parse(await readFile(join(app.music, '.soundboard'), 'utf8'));
	check('header: the volume is saved as the slider position', settings.volumes.master === 0.5, settings.volumes);
	await app.mouse(master.left + master.width * 0.999, master.top + master.height / 2);
	await evaluate(`document.querySelector(${q(header)}).focus()`);
	await pressKey('End', 35);
	await pressKey('ArrowUp', 38);
	await sleep(50);
	check('header: cannot go above 0.0 dB', (await text('[data-volume="master"] [data-gain-readout]')) === '0.0 dB', await text('[data-volume="master"] [data-gain-readout]'));
	await click('[data-volume="master"] [data-gain-readout]');
	await typeText('+6');
	await pressKey('Enter', 13);
	await sleep(50);
	check('header: typing +6 dB clamps to 0.0 dB', (await text('[data-volume="master"] [data-gain-readout]')) === '0.0 dB', await text('[data-volume="master"] [data-gain-readout]'));
	await screenshot(join(SHOTS, '7-header.png'));

	await send('Page.reload');
	await sleep(1000);
	await click('[data-splash]');
	await sleep(800);
	check('after a reload the new title and order are kept', (await text(`[data-sound-id="${SOUND}"]`)) === 'Zzz Last' && (await soundOrder()).at(-1) === SOUND, await soundOrder());
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.join('\n') || '(nothing)'}`);
	await app.close();
}
