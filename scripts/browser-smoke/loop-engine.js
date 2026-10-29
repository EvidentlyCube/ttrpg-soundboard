// Checks WebAudioEngine's setLooping for stream and buffer voices in headless Chromium.
import { launch } from './harness.js';

const pageHtml = `<!doctype html><meta charset="utf-8"><script type="module">
import { WebAudioEngine } from './app/audio/web-audio-engine.js';
const engine = new WebAudioEngine();
engine.unlock();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function stream() {
	const voice = engine.createStreamVoice({ url: '/media/Music%20Order/Order%201.mp3', bus: 'music' });
	let ended = 0;
	voice.on('ended', () => ended++);
	voice.setLooping(true);
	voice.play();
	await wait(1000);
	voice.seek(8.5);
	await wait(2500);
	const afterLoop = { ended, position: +voice.position.toFixed(2) };
	voice.setLooping(false);
	voice.seek(9);
	await wait(1800);
	const result = { afterLoop, afterOff: { ended } };
	voice.stop();
	return result;
}
async function buffer() {
	const voice = engine.createBufferVoice({ buffer: await engine.loadBuffer('/media/Sound%20MP3%20with%20title%20tag.mp3'), bus: 'sfx', startAt: 0.5, endAt: 1.0 });
	let ended = 0;
	voice.on('ended', () => ended++);
	voice.setLooping(true);
	voice.play();
	const positions = [];
	for (let i = 0; i < 12; i++) { await wait(100); positions.push(+voice.position.toFixed(2)); }
	const whileLooping = { ended, inRange: positions.every((p) => p >= 0.5 && p <= 1.0), positions };
	voice.setLooping(false);
	await wait(800);
	const result = { whileLooping, afterOff: { ended } };
	voice.stop();
	return result;
}
window.results = (async () => ({ stream: await stream(), buffer: await buffer() }))();
</script>`;

const app = await launch({ page: 'loop.html', pageHtml, autoplay: true });
try {
	const results = await app.evaluate('Promise.race([window.results, new Promise((r) => setTimeout(() => r("timeout"), 30000))])');
	console.log(JSON.stringify(results, null, 1));
} finally {
	console.log(app.logs.filter((line) => !line.includes('favicon')).join('\n') || '(no console output)');
	await app.close();
}
