import { HttpBackendApi } from './api/backend-api.js';
import { EventSourceServerEvents } from './api/server-events.js';
import { WebAudioEngine } from './audio/web-audio-engine.js';
import { WebAudioWaveformDecoder } from './audio/web-audio-waveform-decoder.js';
import { browserClock } from './browser-clock.js';
import { RemoteController } from './logic/remote-controller.js';
import { Soundboard } from './logic/soundboard.js';
import { App } from './ui/app.js';

const api = new HttpBackendApi();
const serverEvents = new EventSourceServerEvents();
const soundboard = new Soundboard({
	engine: new WebAudioEngine(),
	clock: browserClock,
	api,
	// No `crypto.randomUUID()` for the page id: it doesn't exist over plain http on a LAN address, which blanked the remote page.
	decoder: new WebAudioWaveformDecoder(),
	serverEvents,
	logger: console,
});
const remote = new RemoteController({ api, serverEvents, logger: console });

const root = document.getElementById('app');
if (!root) {
	throw new Error('index.html is missing the #app element');
}
new App(soundboard, remote).mount(root);

// A volume change still waiting for its debounced save must not be lost when the tab closes.
window.addEventListener('pagehide', () => {
	soundboard.flushSettings();
	// Reloading would otherwise keep the role for ten seconds and ask for a confirmation to take it back.
	soundboard.stopHosting({ keepalive: true });
});
