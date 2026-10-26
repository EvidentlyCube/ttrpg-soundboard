import { HttpBackendApi } from './api/backend-api.js';
import { WebAudioEngine } from './audio/web-audio-engine.js';
import { browserClock } from './browser-clock.js';
import { Soundboard } from './logic/soundboard.js';
import { App } from './ui/app.js';

const soundboard = new Soundboard({
	engine: new WebAudioEngine(),
	clock: browserClock,
	api: new HttpBackendApi(),
	logger: console,
});

const root = document.getElementById('app');
if (!root) {
	throw new Error('index.html is missing the #app element');
}
new App(soundboard).mount(root);

// A volume change still waiting for its debounced save must not be lost when the tab closes.
window.addEventListener('pagehide', () => soundboard.flushSettings());
