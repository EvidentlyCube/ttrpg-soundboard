import { join } from 'node:path';
import { test as base } from '@playwright/test';
import { HeaderPage } from '../pages/header.js';
import { TrashPage } from '../pages/dialogs/trash.js';
import { PlaylistEditorPage } from '../pages/dialogs/playlist-editor.js';
import { SoundEditorPage } from '../pages/dialogs/sound-editor.js';
import { FooterPage } from '../pages/footer.js';
import { PlaylistsPage } from '../pages/playlists.js';
import { SoundsPage } from '../pages/sounds.js';
import { SplashPage } from '../pages/splash.js';
import { Audio } from './audio.js';
import { Disk } from './disk.js';
import { startSoundboardServer } from './server.js';

const SUPPORT = import.meta.dirname;
const HELPERS = join(SUPPORT, '..', '..', 'helpers');

/** Opens the page on a fresh server and library, and starts it (DESIGN.md §9.0). */
class Soundboard {
	#page;
	#url;
	#splash;

	/**
	 * @param {import('@playwright/test').Page} page
	 * @param {string} url
	 * @param {string} root the audio folder
	 * @param {SplashPage} splash
	 */
	constructor(page, url, root, splash) {
		this.#page = page;
		this.#url = url;
		this.#splash = splash;
		this.root = root;
	}

	async open() {
		await this.#page.goto(this.#url);
	}

	async waitUntilLoaded() {
		await this.#splash.expectHidden();
	}

	async startAndWaitUntilLoaded() {
		await this.open();
		await this.#splash.click();
		await this.waitUntilLoaded();
	}

	/**
	 * Waits long enough for the app to have noticed a change in the folder, if it is going to: it waits for the folder to
	 * be quiet for a second first (DESIGN.md §5.3). The one place a test waits in real time, to show that nothing happens.
	 */
	async waitForTheFolderToSettle() {
		await this.#page.waitForTimeout(1500);
	}

	async reload() {
		await this.#page.reload();
	}
}

/**
 * @typedef {object} Fixtures
 * @property {Soundboard} soundboard
 * @property {SplashPage} splash
 * @property {PlaylistsPage} playlists
 * @property {SoundsPage} sounds
 * @property {FooterPage} footer
 * @property {Audio} audio
 * @property {HeaderPage} header
 * @property {Disk} disk
 * @property {{ soundEditor: SoundEditorPage, playlistEditor: PlaylistEditorPage, trash: TrashPage }} dialogs
 * @typedef {object} Options
 * @property {string[]} unplayableFormats formats this "browser" cannot play, such as 'ogg' (Safari)
 * @property {'example' | import('../../helpers/tmp-tree.js').TreeSpec} library what the server serves: a copy of the example fixture, or a tree to build
 */

/** @type {import('@playwright/test').Fixtures<Fixtures & Options, {}, import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions>} */
const fixtures = {
	library: ['example', { option: true }],
	unplayableFormats: [[], { option: true }],

	// The real page, with the fakes from test/helpers/ where the browser's audio would be (support/test-main.js).
	page: async ({ page, unplayableFormats }, use) => {
		await page.addInitScript((formats) => {
			globalThis.soundboardTestOptions = { unplayableFormats: formats };
		}, unplayableFormats);
		await page.route('**/app/main.js', (route) => route.fulfill({ path: join(SUPPORT, 'test-main.js'), contentType: 'text/javascript' }));
		await page.route('**/test-support/*.js', (route) => {
			const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
			return route.fulfill({ path: join(HELPERS, name), contentType: 'text/javascript' });
		});
		await use(page);
	},

	soundboard: async ({ page, library, splash }, use) => {
		const server = await startSoundboardServer(library);
		await use(new Soundboard(page, server.url, server.root, splash));
		// The page may still be saving waveforms; stop it before the folder goes.
		await page.goto('about:blank');
		await server.stop();
	},

	splash: async ({ page }, use) => {
		await use(new SplashPage(page));
	},

	playlists: async ({ page }, use) => {
		await use(new PlaylistsPage(page));
	},

	sounds: async ({ page }, use) => {
		await use(new SoundsPage(page));
	},

	footer: async ({ page }, use) => {
		await use(new FooterPage(page));
	},

	disk: async ({ soundboard }, use) => {
		await use(new Disk(soundboard.root));
	},

	dialogs: async ({ page }, use) => {
		await use({ soundEditor: new SoundEditorPage(page), playlistEditor: new PlaylistEditorPage(page), trash: new TrashPage(page) });
	},

	header: async ({ page }, use) => {
		await use(new HeaderPage(page));
	},

	audio: async ({ page }, use) => {
		await use(new Audio(page));
	},
};

export const test = base.extend(fixtures);

export { expect } from '@playwright/test';
