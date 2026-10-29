// Starts the real server on a fixture copy and drives headless Chromium over the DevTools protocol (no npm packages).
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = fileURLToPath(new URL('../..', import.meta.url));

// Screenshots go here, never into the repository.
export const SHOTS = join(tmpdir(), 'soundboard-smoke-shots/');
await mkdir(SHOTS, { recursive: true });
const { BootstrapService } = await import(`${PROJECT}/src/library/bootstrap-service.js`);
const { startServer } = await import(`${PROJECT}/src/http/server.js`);

export async function launch({ extraFiles = {}, page = 'index.html', pageHtml, readyExpression = 'true', autoplay = false, viewport = { width: 1440, height: 900 } } = {}) {
	const work = await mkdtemp(join(tmpdir(), 'soundboard-smoke-'));
	const music = join(work, 'music');
	await cp(`${PROJECT}/test_fixtures/example_soundboard`, music, { recursive: true });
	for (const [path, content] of Object.entries(extraFiles)) {
		await writeFile(join(music, path), content);
	}
	const publicDir = join(work, 'public');
	await cp(`${PROJECT}/public`, publicDir, { recursive: true });
	if (pageHtml) {
		await writeFile(join(publicDir, page), pageHtml);
	}
	const reporter = new Proxy({}, { get: () => () => {} });
	const outcome = await new BootstrapService({ prompter: { confirm: async () => true }, reporter }).run(music);
	const requests = [];
	const server = await startServer({
		library: outcome.library, settings: outcome.settings, port: 0, publicDir,
		logError: (error) => console.error('SERVER ERROR', error),
		logRequest: (line) => requests.push(line),
	});

	const profile = join(work, 'profile');
	const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--mute-audio', '--no-first-run', 'about:blank'];
	if (autoplay) {
		flags.unshift('--autoplay-policy=no-user-gesture-required');
	}
	const chrome = spawn('chromium-browser', flags, { stdio: 'ignore' });
	let port = null;
	for (let i = 0; i < 100 && !port; i++) {
		await sleep(100);
		port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then((text) => text.split('\n')[0], () => null);
	}
	const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

	let nextId = 0;
	const pending = new Map();
	const logs = [];
	ws.addEventListener('message', ({ data }) => {
		const message = JSON.parse(data);
		if (message.id && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
		}
		if (message.method === 'Runtime.consoleAPICalled') {
			logs.push(`${message.params.type}: ${message.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`);
		} else if (message.method === 'Runtime.exceptionThrown') {
			logs.push(`EXCEPTION: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
		} else if (message.method === 'Log.entryAdded') {
			logs.push(`log ${message.params.entry.level}: ${message.params.entry.text} ${message.params.entry.url ?? ''}`);
		}
	});
	const send = (method, params = {}) => new Promise((resolve) => {
		const id = ++nextId;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async (expression) => {
		const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		}
		return result.result.value;
	};

	await send('Runtime.enable');
	await send('Log.enable');
	await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
	await send('Page.navigate', { url: `${server.url}/${page}` });
	for (let i = 0; i < 100 && !(await evaluate(`document.readyState === 'complete' && (${readyExpression})`).catch(() => false)); i++) {
		await sleep(100);
	}

	/** Real input events, so the page sees genuine user gestures. */
	// `buttons` must describe what is held, or Chromium thinks an earlier button is still down and drops the click.
	const mouse = async (x, y, button = 'left') => {
		const held = button === 'right' ? 2 : 1;
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: held, clickCount: 1 });
		await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
	};
	const centerOf = async (selector) => {
		const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
		if (!rect) {
			throw new Error(`No element matches ${selector}`);
		}
		return rect;
	};
	const click = async (selector, button = 'left') => {
		const { x, y } = await centerOf(selector);
		await mouse(x, y, button);
	};
	const key = async (keyName) => {
		await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: keyName === 'Escape' ? 27 : 0 });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: keyName === 'Escape' ? 27 : 0 });
	};
	const screenshot = async (path) => {
		const { result } = await send('Page.captureScreenshot', { format: 'png' });
		await writeFile(path, Buffer.from(result.data, 'base64'));
	};
	const close = async () => {
		ws.close();
		chrome.kill();
		await server.close();
		await sleep(300);
		await rm(work, { recursive: true, force: true });
	};
	return { evaluate, send, logs, requests, music, mouse, click, centerOf, key, screenshot, close, sleep };
}

export function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
