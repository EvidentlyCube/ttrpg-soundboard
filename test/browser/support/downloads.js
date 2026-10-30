import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeProcessRunner } from '../../helpers/fake-process-runner.js';

/** @typedef {import('../../../src/downloads/link-fetcher.js').LinkInfo} LinkInfo */

/**
 * Which of yt-dlp and ffmpeg the server finds when it starts.
 * @typedef {'none' | 'both' | 'withoutFfmpeg'} DownloadTools
 */

/**
 * The programs behind the server's downloads: a yt-dlp that knows a few links, and an ffmpeg that writes the file it is
 * asked for. Nothing real runs. A test says what the "internet" holds with `addVideo`, `addPlaylist` and `addFile`, and can
 * hold a download open with `hold` to look at the dialog while it runs.
 */
export class FakeDownloads {
	/** What `yt-dlp -J` prints for a link, or the error it prints. @type {Map<string, { json: unknown } | { error: string }>} */
	#pages = new Map();
	/** Direct links to files, which the server fetches itself. @type {Map<string, LinkInfo>} */
	#files = new Map();
	/** Video ids that fail to download, with what yt-dlp says. @type {Map<string, string>} */
	#failing = new Map();
	/** The title of every video, to name the file yt-dlp writes. @type {Map<string, string>} */
	#titles = new Map();
	/** A download waits for this before finishing. @type {Promise<void>} */
	#gate = Promise.resolve();
	/** @type {() => void} */
	#open = () => {};
	#runner = fakeProcessRunner((command, args, process) => this.#program(command, args, process));

	/** The programs the server runs. */
	get run() {
		return this.#runner.run;
	}

	/** What the server has run so far: `{ command, args }` for every lookup, download and conversion. */
	get calls() {
		return this.#runner.calls;
	}

	/** Direct links, as the server's fetcher sees them. @type {import('../../../src/downloads/link-fetcher.js').LinkFetcher} */
	fetcher = {
		inspect: async (url) => this.#files.get(url) ?? null,
		download: async (url, path, { onProgress }) => {
			const info = this.#files.get(url);
			await this.#gate;
			await writeFile(path, 'mp3');
			onProgress(info?.size ?? 0);
		},
	};

	/**
	 * A video yt-dlp can look up.
	 * @param {string} url
	 * @param {{ id: string, title: string, duration?: number, size?: number | null, chapters?: { title: string, start: number, end: number }[] }} video
	 */
	addVideo(url, { id, title, duration = 60, size = 1_000_000, chapters = [] }) {
		this.#titles.set(id, title);
		this.#pages.set(url, {
			json: {
				_type: 'video',
				id,
				title,
				duration,
				...(size === null ? {} : { filesize: size }),
				extractor_key: 'Youtube',
				webpage_url: url,
				chapters: chapters.map((chapter) => ({ title: chapter.title, start_time: chapter.start, end_time: chapter.end })),
			},
		});
	}

	/**
	 * A playlist yt-dlp can look up; its entries can be downloaded by their own links, `https://video.test/watch?v=<id>`.
	 * @param {string} url
	 * @param {{ id: string, title: string, entries: { id: string, title: string, duration?: number }[], total?: number }} playlist
	 */
	addPlaylist(url, { id, title, entries, total }) {
		for (const entry of entries) {
			this.#titles.set(entry.id, entry.title);
		}
		const page = {
			json: {
				_type: 'playlist',
				id,
				title,
				webpage_url: url,
				...(total === undefined ? {} : { playlist_count: total }),
				entries: entries.map((entry) => ({ id: entry.id, title: entry.title, duration: entry.duration ?? 60, url: `https://video.test/watch?v=${entry.id}`, ie_key: 'Youtube' })),
			},
		};
		// A link that names a video as well gives the video, until the playlist is asked for.
		this.#pages.set(`${url}#playlist`, page);
		if (!this.#pages.has(url)) {
			this.#pages.set(url, page);
		}
	}

	/**
	 * A direct link to an audio file.
	 * @param {string} url
	 * @param {{ name: string, size?: number | null, contentType?: string }} file
	 */
	addFile(url, { name, size = 2000, contentType = 'audio/mpeg' }) {
		this.#files.set(url, { name, size, contentType });
	}

	/**
	 * A link yt-dlp cannot look up.
	 * @param {string} url
	 * @param {string} message what yt-dlp says, such as `ERROR: [generic] Unsupported URL`
	 */
	addUnusableLink(url, message) {
		this.#pages.set(url, { error: message });
	}

	/**
	 * Makes downloading this video fail.
	 * @param {string} id
	 * @param {string} message
	 */
	failVideo(id, message) {
		this.#failing.set(id, message);
	}

	/** Makes every download wait, until `release`. Call it before the download starts. */
	hold() {
		this.#gate = new Promise((resolve) => {
			this.#open = () => resolve(undefined);
		});
	}

	/** Lets the downloads that are waiting go on. */
	release() {
		this.#open();
		this.#gate = Promise.resolve();
	}

	/**
	 * @param {string} command
	 * @param {string[]} args
	 * @param {import('../../helpers/fake-process-runner.js').FakeProcess} process
	 * @returns {Promise<Partial<import('../../../src/downloads/process-runner.js').RunResult>>}
	 */
	async #program(command, args, process) {
		if (command === 'ffmpeg') {
			await writeFile(/** @type {string} */ (args.at(-1)), 'audio');
			return { code: 0 };
		}
		const url = /** @type {string} */ (args.at(-1));
		if (args.includes('-J')) {
			const page = (args.includes('--yes-playlist') ? this.#pages.get(`${url}#playlist`) : undefined) ?? this.#pages.get(url);
			if (page === undefined) {
				process.line('ERROR: [generic] Unsupported URL');
				return { code: 1 };
			}
			if ('error' in page) {
				process.line(page.error);
				return { code: 1 };
			}
			return { stdout: JSON.stringify(page.json) };
		}
		const id = new URL(url).searchParams.get('v') ?? url;
		process.line('[download]  42.0%', true);
		await Promise.race([this.#gate, new Promise((resolve) => process.killed.addEventListener('abort', resolve))]);
		if (process.killed.aborted) {
			return { code: null, signal: 'SIGTERM' };
		}
		const failure = this.#failing.get(id);
		if (failure !== undefined) {
			process.line(`ERROR: ${failure}`);
			return { code: 1 };
		}
		process.line('[download] 100%');
		await writeFile(join(args[args.indexOf('-P') + 1], `${this.#titles.get(id) ?? id} [${id}].webm`), 'webm');
		return { code: 0 };
	}
}

/**
 * What the server is told about its tools.
 * @param {DownloadTools} tools
 * @param {FakeDownloads} downloads
 * @returns {{ tools: { ytDlp: string | null, ffmpeg: string | null }, run: FakeDownloads['run'], fetcher: FakeDownloads['fetcher'] } | undefined}
 */
export function downloadSetup(tools, downloads) {
	if (tools === 'none') {
		return undefined;
	}
	return {
		tools: { ytDlp: '2026.08.19', ffmpeg: tools === 'both' ? '7.1' : null },
		run: downloads.run,
		fetcher: downloads.fetcher,
	};
}
