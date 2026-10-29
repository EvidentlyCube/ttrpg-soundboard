import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const app = await launch({ readyExpression: '!!document.querySelector("[data-splash]")' });
const { evaluate, click, key, sleep, screenshot, logs, requests } = app;
const results = {};
const check = (name, ok, detail) => {
	results[name] = ok ? 'ok' : `FAIL ${JSON.stringify(detail)}`;
};
const q = (selector) => JSON.stringify(selector);
const text = (selector) => evaluate(`document.querySelector(${q(selector)})?.textContent ?? null`);
const attr = (selector, name) => evaluate(`document.querySelector(${q(selector)})?.getAttribute(${q(name)}) ?? null`);
const count = (selector) => evaluate(`document.querySelectorAll(${q(selector)}).length`);
const visible = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); return !!el && el.checkVisibility(); })()`);
const bar = (id) => `[data-player-bar="${id}"]`;

try {
	await sleep(300);
	check('splash says click to start', (await text('[data-splash]'))?.includes('Click anywhere to start'), await text('[data-splash]'));
	check('nothing requested before the click', !requests.some((line) => line.startsWith('GET /api/')), requests);
	await screenshot(join(SHOTS, '0-splash.png'));

	await click('[data-splash]');
	await sleep(800);
	check('splash gone after start', !(await visible('[data-splash]')), await text('[data-splash]'));
	check('3 playlist tiles', (await count('[data-playlist-id]')) === 3, await count('[data-playlist-id]'));
	check('4 sound tiles', (await count('[data-sound-id]')) === 4, await count('[data-sound-id]'));
	check('tile titles come from metadata', (await text('[data-sound-id="Sound MP3 with title tag.mp3"]')) === 'Base Connected', await text('[data-sound-id="Sound MP3 with title tag.mp3"]'));
	const tileStyle = await evaluate('(() => { const s = getComputedStyle(document.querySelector("[data-playlist-id]")); return [s.backgroundColor, s.borderLeftColor, s.borderLeftWidth]; })()');
	check('Tailwind styles applied', tileStyle[0] === 'rgb(29, 33, 41)' && tileStyle[1] === 'rgb(91, 140, 255)' && tileStyle[2] === '4px', tileStyle);
	const emptyDockHeight = await evaluate('document.querySelector("[data-player-dock]").getBoundingClientRect().height');
	check('footer visible with a placeholder while nothing plays', (await visible('[data-player-dock]')) && (await visible('[data-dock-placeholder]')), null);

	await click('[data-playlist-id="Music MP3"]');
	await sleep(1500);
	check('playing tile highlighted', (await attr('[data-playlist-id="Music MP3"]', 'data-active')) === 'true', null);
	const playingDockHeight = await evaluate('document.querySelector("[data-player-dock]").getBoundingClientRect().height');
	check('footer shows one bar instead of the placeholder', !(await visible('[data-dock-placeholder]')) && (await count('[data-player-bar]')) === 1, await count('[data-player-bar]'));
	check('footer height does not change when music starts', emptyDockHeight === playingDockHeight && emptyDockHeight > 100, { emptyDockHeight, playingDockHeight });
	const time = await text(`${bar('Music MP3')} .tabular-nums`);
	check('bar shows track and time', (await text(`${bar('Music MP3')} button[title="Choose a track"]`)) === 'Piece by Piece' && /^0:0[1-9] \/ 0:\d\d$/.test(time ?? ''), { time });
	const fillWidth = await evaluate(`parseFloat(document.querySelector(${q(bar('Music MP3'))} + " .bg-music.absolute")?.style.width ?? "0")`).catch(() => null);

	await click('[data-playlist-id="Music Ogg"]');
	await sleep(1000);
	const bars = await evaluate('[...document.querySelectorAll("[data-player-bar]")].map((el) => el.dataset.playerBar)');
	check('second bar appended in start order', JSON.stringify(bars) === JSON.stringify(['Music MP3', 'Music Ogg']), bars);

	await click('[data-sound-id="Sound OGG no title tag.ogg"]');
	await sleep(400);
	check('stop button appears on a playing sound', await visible('[data-stop-sound="Sound OGG no title tag.ogg"]'), null);
	check('sounds never add a player bar', (await count('[data-player-bar]')) === 2, await count('[data-player-bar]'));
	await screenshot(join(SHOTS, '1-board-playing.png'));
	await click('[data-stop-sound="Sound OGG no title tag.ogg"]');
	await sleep(200);
	check('stop button stops the sound', !(await visible('[data-stop-sound="Sound OGG no title tag.ogg"]'))
	&& (await attr('[data-sound-id="Sound OGG no title tag.ogg"]', 'data-active')) === 'false', null);

	await click(`${bar('Music MP3')} [data-control="pause"]`);
	await sleep(100);
	const pausedTime = await text(`${bar('Music MP3')} .tabular-nums`);
	await sleep(1200);
	check('pause freezes the time', pausedTime === (await text(`${bar('Music MP3')} .tabular-nums`)) && (await attr(`${bar('Music MP3')} [data-control="pause"]`, 'title')) === 'Resume', pausedTime);
	await click(`${bar('Music MP3')} [data-control="pause"]`);

	const progress = await app.centerOf(`${bar('Music MP3')} [data-progress]`);
	const progressBox = await evaluate(`(() => { const r = document.querySelector(${q(`${bar('Music MP3')} [data-progress]`)}).getBoundingClientRect(); return { left: r.left, width: r.width }; })()`);
	await app.mouse(progressBox.left + progressBox.width * 0.9, progress.y);
	await sleep(600);
	const afterSeek = await text(`${bar('Music MP3')} .tabular-nums`);
	const [position, duration] = (afterSeek ?? '').split(' / ').map((part) => part.split(':').reduce((total, unit) => total * 60 + Number(unit), 0));
	check('clicking the progress bar seeks', duration > 0 && position / duration > 0.8, { afterSeek, fillWidth });

	await click(`${bar('Music Ogg')} button[title="Choose a track"]`);
	await sleep(200);
	const listBox = await evaluate('(() => { const r = document.querySelector("[data-overlay-backdrop]").nextElementSibling.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight }; })()');
	check('track list opens fully on screen the first time', listBox.top >= 0 && listBox.bottom <= listBox.height, listBox);
	check('track list lists both tracks, current marked', (await count('[data-track-index]')) === 2 && (await attr('[data-track-index="0"]', 'data-current')) === 'true', await count('[data-track-index]'));
	await click('[data-track-index="1"]');
	await sleep(800);
	check('choosing a track jumps to it', (await text(`${bar('Music Ogg')} button[title="Choose a track"]`)) === 'Intro' && (await count('[data-overlay-backdrop]')) === 0, await text(`${bar('Music Ogg')} button[title="Choose a track"]`));

	await click('[data-playlist-id="Music Ogg"]', 'right');
	await sleep(200);
	const enabled = await evaluate('[...document.querySelectorAll("[data-menu-item]")].filter((el) => !el.disabled).map((el) => el.textContent)');
	check('playlist menu enables next/stop while active', JSON.stringify(enabled) === JSON.stringify(['Next', 'Next (Instant)', 'Stop', 'Stop (Instant)', 'Customize']), enabled);
	await screenshot(join(SHOTS, '2-context-menu.png'));

	const outside = '[data-sound-id="Sound MP3 with title tag.mp3"]';
	const outsidePoint = await app.centerOf(outside);
	const underCursor = await evaluate(`document.elementFromPoint(${outsidePoint.x}, ${outsidePoint.y})?.hasAttribute('data-overlay-backdrop')`);
	await click(outside);
	await sleep(300);
	check('click outside closes the menu without playing the tile underneath', underCursor
	&& (await count('[data-overlay-backdrop]')) === 0
	&& (await attr(outside, 'data-active')) === 'false'
	&& (await attr('[data-playlist-id="Music Ogg"]', 'data-active')) === 'true', { underCursor });

	await click('[data-sound-id="Sound MP3 no title tag.mp3"]', 'right');
	await sleep(150);
	await key('Escape');
	await sleep(150);
	check('Esc closes the menu', (await count('[data-overlay-backdrop]')) === 0, null);

	await evaluate(`(() => {
		window.__events = [];
		const describe = (el) => el?.dataset?.menuItem ? 'item:' + el.dataset.menuItem : el?.dataset?.playlistId ? 'tile:' + el.dataset.playlistId : el?.hasAttribute?.('data-overlay-backdrop') ? 'backdrop' : el?.tagName;
		for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu']) {
			document.addEventListener(type, (event) => window.__events.push(type + '(' + event.button + ')@' + describe(event.target.closest('[data-menu-item],[data-playlist-id],[data-overlay-backdrop]') ?? event.target)), true);
		}
	})()`);
	await click('[data-playlist-id="Music Ogg"]', 'right');
	await sleep(150);
	await click('[data-menu-item="stopInstant"]');
	await sleep(100);
	console.log('DEBUG events:', await evaluate('window.__events.join(" → ")'));
	await sleep(300);
	check('Stop (Instant) from the menu removes the bar', JSON.stringify(await evaluate('[...document.querySelectorAll("[data-player-bar]")].map((el) => el.dataset.playerBar)')) === '["Music MP3"]', null);

	console.log('DEBUG overlay after Stop (Instant):', await evaluate(`[...document.querySelectorAll('[data-overlay-backdrop]')].map((el) => el.nextElementSibling?.outerHTML.slice(0, 200)).join(' | ') || 'none'`));
	const stopCenter = await app.centerOf(`${bar('Music MP3')} [data-control="stop"]`);
	console.log('DEBUG stop button:', JSON.stringify(stopCenter), await evaluate(`(() => { const el = document.elementFromPoint(${stopCenter.x}, ${stopCenter.y}); return el?.outerHTML.slice(0, 160); })()`));
	await click(`${bar('Music MP3')} [data-control="stop"]`);
	await sleep(300);
	const debugExpression = `({
		dockHidden: document.querySelector('[data-player-dock]').hidden,
		dockVisible: document.querySelector('[data-player-dock]').checkVisibility(),
		bars: [...document.querySelectorAll('[data-player-bar]')].map((el) => el.dataset.playerBar),
		active: document.querySelector('[data-playlist-id="Music MP3"]').dataset.active,
		overlays: document.querySelectorAll('[data-overlay-backdrop]').length,
	})`;
	console.log('DEBUG after stop:', JSON.stringify(await evaluate(debugExpression)));
	check('placeholder returns when the last playlist stops', (await visible('[data-dock-placeholder]'))
	&& (await attr('[data-playlist-id="Music MP3"]', 'data-active')) === 'false', null);

	await evaluate('document.querySelector("[data-volume=music] [data-gain-track]").focus()');
	await key('Home');
	await sleep(900);
	const saved = JSON.parse(await readFile(join(app.music, '.soundboard'), 'utf8')).volumes;
	check('header volume saves after the debounce', saved.music === 0, saved);
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.join('\n') || '(nothing)'}`);
	await app.close();
}
