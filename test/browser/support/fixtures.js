import { join } from 'node:path';
import { test as base } from '@playwright/test';
import { HeaderPage } from '../pages/header.js';
import { AddDialogPage } from '../pages/dialogs/add-dialog.js';
import { DownloadDialogPage } from '../pages/dialogs/download-dialog.js';
import { MetadataPage } from '../pages/dialogs/metadata.js';
import { MoveDialogPage } from '../pages/dialogs/move-dialog.js';
import { TrashPage } from '../pages/dialogs/trash.js';
import { PlaylistEditorPage } from '../pages/dialogs/playlist-editor.js';
import { SoundEditorPage } from '../pages/dialogs/sound-editor.js';
import { FooterPage } from '../pages/footer.js';
import { PlaylistsPage } from '../pages/playlists.js';
import { SoundsPage } from '../pages/sounds.js';
import { SplashPage } from '../pages/splash.js';
import { Audio } from './audio.js';
import { Disk } from './disk.js';
import { downloadSetup, FakeDownloads } from './downloads.js';
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

	/** Where the server is, for a second page. */
	get url() {
		return this.#url;
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
 * @property {{ soundEditor: SoundEditorPage, playlistEditor: PlaylistEditorPage, trash: TrashPage, move: MoveDialogPage, metadata: MetadataPage, add: AddDialogPage, download: DownloadDialogPage }} dialogs
 * @typedef {object} Options
 * @property {string[]} unplayableFormats formats this "browser" cannot play, such as 'ogg' (Safari)
 * @property {'example' | import('../../helpers/tmp-tree.js').TreeSpec} library what the server serves: a copy of the example fixture, or a tree to build
 * @property {number | undefined} randomSeed makes the random and shuffle orders repeatable; without it they are random
 * @property {import('./downloads.js').DownloadTools} downloadTools which of yt-dlp and ffmpeg the server finds; none by default
 * @property {FakeDownloads} downloads what the fake yt-dlp and ffmpeg know and do
 * @property {import('../../../src/downloads/yt-dlp-update.js').YtDlpUpdate | null} ytDlpUpdate what `yt-dlp -U` did at
 * 	startup; with tools only

 * @property {boolean} lan whether the server runs as with `--lan` (DESIGN.md §5.6)
 */

/** @type {import('@playwright/test').Fixtures<Fixtures & Options, {}, import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions>} */
const fixtures = {
	library: ['example', { option: true }],
	lan: [false, { option: true }],
	downloadTools: ['none', { option: true }],
	ytDlpUpdate: [null, { option: true }],
	unplayableFormats: [[], { option: true }],
	randomSeed: [undefined, { option: true }],

	// The real page, with the fakes from test/helpers/ where the browser's audio would be (support/test-main.js). Set on
	// the context, so a second page of a test (a remote control) gets them too.
	page: async ({ page, unplayableFormats, randomSeed }, use) => {
		const context = page.context();
		await context.addInitScript(({ formats, seed }) => {
			globalThis.soundboardTestOptions = { unplayableFormats: formats, ...(seed === undefined ? {} : { randomSeed: seed }) };
		}, { formats: unplayableFormats, seed: randomSeed });
		await context.route('**/app/main.js', (route) => route.fulfill({ path: join(SUPPORT, 'test-main.js'), contentType: 'text/javascript' }));
		await context.route('**/test-support/*.js', (route) => {
			const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
			return route.fulfill({ path: join(HELPERS, name), contentType: 'text/javascript' });
		});
		await use(page);
	},

	// Playwright reads which fixtures a function needs from its first parameter, which must be a destructuring pattern.
	// eslint-disable-next-line no-empty-pattern
	downloads: async ({}, use) => {
		await use(new FakeDownloads());
	},

	soundboard: async ({ page, library, lan, splash, downloadTools, downloads, ytDlpUpdate }, use) => {
		const server = await startSoundboardServer(library, { lan, downloads: downloadSetup(downloadTools, downloads, ytDlpUpdate) });
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
		await use({
			soundEditor: new SoundEditorPage(page),
			playlistEditor: new PlaylistEditorPage(page),
			trash: new TrashPage(page),
			move: new MoveDialogPage(page),
			metadata: new MetadataPage(page),
			add: new AddDialogPage(page),
			download: new DownloadDialogPage(page),
		});
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
