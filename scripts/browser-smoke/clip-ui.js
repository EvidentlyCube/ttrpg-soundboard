import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const SOUND = 'Sound MP3 with title tag.mp3';
const app = await launch({ readyExpression: '!!document.querySelector("[data-splash]")' });
const { evaluate, click, mouse, key, sleep, screenshot, logs, send } = app;
const results = {};
const check = (name, ok, detail) => {
	results[name] = ok ? 'ok' : `FAIL ${JSON.stringify(detail)}`;
};
const q = (selector) => JSON.stringify(selector);
const text = (selector) => evaluate(`document.querySelector(${q(selector)})?.textContent ?? null`);
const value = (selector) => evaluate(`document.querySelector(${q(selector)})?.value ?? null`);
const attr = (selector, name) => evaluate(`document.querySelector(${q(selector)})?.getAttribute(${q(name)}) ?? null`);
const rect = (selector) => evaluate(`(() => { const r = document.querySelector(${q(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const pressKey = async (keyName, code, modifiers = 0) => {
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: code, modifiers });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: code, modifiers });
};
const drag = async (from, to) => {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, buttons: 0 });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
	for (let i = 1; i <= 5; i++) {
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 5, y: to.y, button: 'left', buttons: 1 });
	}
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
};
const optionsFile = async () => JSON.parse(await readFile(join(app.music, `${SOUND}.json`), 'utf8'));

try {
	await click('[data-splash]');
	await sleep(800);
	await click(`[data-sound-id="${SOUND}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);

	const duration = (await (await fetch('http://x').catch(() => null)), await evaluate(`fetch('/api/library').then((r) => r.json()).then((l) => l.sounds.find((s) => s.id === ${q(SOUND)}).duration)`));
	const durationMs = Math.round(duration * 1000);
	check('the section shows the whole file', (await value('[data-range-field="start"]')) === '0' && (await value('[data-range-field="end"]')) === String(durationMs), [await value('[data-range-field="start"]'), await value('[data-range-field="end"]'), durationMs]);
	check('the length readout', (await text('[data-range-length]')) === `Plays ${durationMs.toLocaleString('en-US')} ms of ${durationMs.toLocaleString('en-US')} ms`, await text('[data-range-length]'));
	check('fade sections are there', (await evaluate('document.querySelectorAll("[data-dialog] [role=slider]").length')) >= 4, null);
	await screenshot(join(SHOTS, 'clip-1-initial.png'));

	// Drag the start handle to a quarter of the track.
	const track = await rect('[data-range-track]');
	const start = await rect('[data-range-handle="start"]');
	await drag({ x: start.x + start.w / 2, y: start.y + start.h / 2 }, { x: track.x + track.w * 0.25, y: track.y + track.h / 2 });
	await sleep(100);
	const startMs = Number(await value('[data-range-field="start"]'));
	check('dragging the start handle moves the start point', Math.abs(startMs - durationMs * 0.25) < durationMs * 0.02, { startMs, expected: durationMs * 0.25 });
	check('the start handle has focus after the drag', (await evaluate('document.activeElement?.dataset.rangeHandle')) === 'start', null);

	// Press the track near the right end: moves the end handle.
	await mouse(track.x + track.w * 0.8, track.y + track.h / 2);
	await sleep(100);
	const endMs = Number(await value('[data-range-field="end"]'));
	check('pressing the track moves the nearer handle', Math.abs(endMs - durationMs * 0.8) < durationMs * 0.02, { endMs });

	// Keyboard: Shift+ArrowLeft on the end handle steps 100 ms.
	await pressKey('ArrowLeft', 37, 8);
	await sleep(50);
	check('Shift + arrow steps 100 ms', Number(await value('[data-range-field="end"]')) === endMs - 100, await value('[data-range-field="end"]'));
	await pressKey('Home', 36);
	await sleep(50);
	check('Home puts the end 10 ms after the start', Number(await value('[data-range-field="end"]')) === startMs + 10, await value('[data-range-field="end"]'));
	await pressKey('End', 35);
	await sleep(50);
	check('End puts the end at the end of the file', Number(await value('[data-range-field="end"]')) === durationMs, null);

	// Type into the start field.
	await evaluate(`(() => { const f = document.querySelector('[data-range-field="start"]'); f.focus(); f.select(); })()`);
	await send('Input.insertText', { text: '1,000 ms' });
	await pressKey('Enter', 13);
	await sleep(100);
	check('typing a start applies it', (await value('[data-range-field="start"]')) === '1000', await value('[data-range-field="start"]'));
	await evaluate(`(() => { const f = document.querySelector('[data-range-field="start"]'); f.select(); })()`);
	await send('Input.insertText', { text: 'nonsense' });
	await pressKey('Enter', 13);
	check('unreadable text is marked red', (await attr('[data-range-field="start"]', 'data-invalid')) === 'true', null);
	await pressKey('Escape', 27);
	await sleep(100);
	check('Esc restores the field and keeps the dialog open', (await value('[data-range-field="start"]')) === '1000' && (await evaluate('!!document.querySelector("[data-dialog]")')), null);
	await screenshot(join(SHOTS, 'clip-2-edited.png'));

	await sleep(700);
	let saved = await optionsFile();
	check('the points are saved, the end as null at the end of the file', saved.startAt === 1 && saved.endAt === null, saved);

	await evaluate(`(() => { const f = document.querySelector('[data-range-field="end"]'); f.focus(); f.select(); })()`);
	await send('Input.insertText', { text: '1200' });
	await evaluate('document.activeElement.blur()');
	await sleep(700);
	saved = await optionsFile();
	check('leaving the end field applies and saves it', saved.endAt === 1.2, saved);
	check('the readout follows', (await text('[data-range-length]')) === `Plays 200 ms of ${durationMs.toLocaleString('en-US')} ms`, await text('[data-range-length]'));

	await click('[data-range-reset]');
	await sleep(700);
	saved = await optionsFile();
	check('Reset plays the whole file again', saved.startAt === 0 && saved.endAt === null, saved);

	// Set points again plus a fade-in, then play from the dialog: the press ends at the end point.
	await evaluate(`(() => { const f = document.querySelector('[data-range-field="end"]'); f.focus(); f.select(); })()`);
	await send('Input.insertText', { text: '500' });
	await pressKey('Enter', 13);
	await sleep(100);
	await click('[data-dialog] [data-item-preview]');
	const t0 = Date.now();
	let active = true;
	while (active && Date.now() - t0 < 3000) {
		await sleep(25);
		active = await evaluate(`document.querySelector('[data-sound-id=${JSON.stringify(SOUND)}]')?.dataset.active === 'true'`);
	}
	const playedMs = Date.now() - t0;
	check('a press plays only up to the end point', !active && playedMs < 900, { playedMs, active });

	await key('Escape');
	await sleep(300);
	check('the dialog closes', !(await evaluate('!!document.querySelector("[data-dialog]")')), null);
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.filter((line) => !line.includes('favicon')).join('\n') || '(nothing)'}`);
	await app.close();
}
