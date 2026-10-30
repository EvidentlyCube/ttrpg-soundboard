import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DownloadService, MAX_LOG_LINES } from '../../../src/downloads/download-service.js';
import { DownloadBusyError, InvalidDownloadError, ToolsUnavailableError } from '../../../src/downloads/errors.js';
import { WORKSPACE_NAME } from '../../../src/downloads/workspace.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { LibraryEditor } from '../../../src/library/library-editor.js';
import { FakeClock } from '../../helpers/fake-clock.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @typedef {import('../../../src/downloads/download-service.js').DownloadEvent} DownloadEvent */
/** @typedef {import('../../../src/downloads/download-service.js').Job} Job */

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

const VIDEO = {
	kind: /** @type {const} */ ('video'),
	url: 'https://www.youtube.com/watch?v=zoo',
	id: 'zoo',
	title: 'Me at the zoo',
	duration: 19,
	size: 1000,
	extractor: 'Youtube',
	chapters: [{ title: 'Intro', start: 0, end: 5 }, { title: 'Middle', start: 5, end: 17 }, { title: 'End', start: 17, end: 19 }],
	playlistAvailable: false,
};

const PLAYLIST = {
	kind: /** @type {const} */ ('playlist'),
	url: 'https://www.youtube.com/playlist?list=PL1',
	id: 'PL1',
	title: 'Battle music',
	entries: ['a', 'b', 'c'].map((id) => ({ id, title: `Song ${id}`, duration: 60, url: `https://www.youtube.com/watch?v=${id}`, extractor: 'Youtube' })),
	truncated: false,
};

/** Stands in for yt-dlp: makes a file named as yt-dlp would, or fails for the ids in `failing`. */
class FakeYtDlp {
	/** @type {import('../../../src/downloads/probe.js').VideoProbe | import('../../../src/downloads/probe.js').PlaylistProbe} */
	probeResult = VIDEO;
	/** @type {Set<string>} */
	failing = new Set();
	/** @type {string[]} */
	downloads = [];
	/** A download waits for this before finishing, so tests can act while it runs. @type {Promise<void>} */
	gate = Promise.resolve();
	/** @type {{ link: URL, playlist: boolean }[]} */
	probes = [];

	/**
	 * @param {URL} link
	 * @param {{ playlist: boolean }} options
	 */
	async probe(link, { playlist }) {
		this.probes.push({ link, playlist });
		return this.probeResult;
	}

	/**
	 * @param {string} url
	 * @param {string} directory
	 * @param {{ signal: AbortSignal, onLine: (text: string, transient: boolean) => void, onCommand: (line: string) => void }} options
	 */
	async download(url, directory, { signal, onLine, onCommand }) {
		this.downloads.push(url);
		onCommand(`$ yt-dlp ${url}`);
		onLine('[download]  50%', true);
		onLine('[download] 100%', false);
		await Promise.race([this.gate, new Promise((resolve) => signal.addEventListener('abort', resolve))]);
		signal.throwIfAborted();
		const id = new URL(url).searchParams.get('v') ?? 'x';
		if (this.failing.has(id)) {
			throw new Error(`Video ${id} is unavailable`);
		}
		const title = id === 'zoo' ? 'Me at the zoo' : `Song ${id}`;
		await writeFile(join(directory, `${title} [${id}].webm`), 'webm');
		await writeFile(join(directory, `${title} [${id}].webm.part`), 'leftover');
	}
}

/** Stands in for ffmpeg: writes the output and records each conversion. */
class FakeFfmpeg {
	/** @type {{ input: string, output: string, clip: { start: number, end: number } | null }[]} */
	conversions = [];
	/** @type {{ input: string, output: string }[]} */
	remuxes = [];
	remuxFails = false;

	/**
	 * @param {string} input
	 * @param {string} output
	 * @param {{ onCommand: (line: string) => void }} options
	 */
	async remux(input, output, { onCommand }) {
		this.remuxes.push({ input: basename(input), output: basename(output) });
		onCommand(`$ ffmpeg -c:a copy ${basename(output)}`);
		if (this.remuxFails) {
			throw new Error('Invalid audio codec');
		}
		await writeFile(output, 'opus');
	}

	/**
	 * @param {string} input
	 * @param {string} output
	 * @param {{ clip: { start: number, end: number } | null, onCommand: (line: string) => void }} options
	 */
	async convert(input, output, { clip, onCommand }) {
		this.conversions.push({ input: basename(input), output: basename(output), clip });
		onCommand(`$ ffmpeg ${basename(output)}`);
		await writeFile(output, 'ogg');
	}
}

/** Stands in for fetching direct links. */
class FakeFetcher {
	/** @type {import('../../../src/downloads/link-fetcher.js').LinkInfo | null} */
	info = null;
	/** @type {string[]} */
	downloads = [];

	/** @param {string} _url */
	async inspect(_url) {
		return this.info;
	}

	/**
	 * @param {string} url
	 * @param {string} path
	 * @param {{ onProgress: (received: number) => void }} options
	 */
	async download(url, path, { onProgress }) {
		this.downloads.push(url);
		onProgress(2);
		onProgress(4);
		await writeFile(path, 'file');
	}
}

/** @param {{ tools?: import('../../../src/downloads/tools.js').Tools }} [options] */
async function setup({ tools = { ytDlp: '2026.08.19', ffmpeg: '7.1' } } = {}) {
	const tree = await createTmpTree({ '.soundboard': JSON.stringify({ version: 1 }), 'Boom.mp3': 'boom', 'Combat': { '1.mp3': 'one' } });
	trees.push(tree);
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
	assert.equal(outcome.status, 'ready');
	const library = outcome.library;
	const editor = new LibraryEditor(library);
	const ytDlp = new FakeYtDlp();
	const ffmpeg = new FakeFfmpeg();
	const fetcher = new FakeFetcher();
	let additions = 0;
	const service = new DownloadService({
		root: tree.root,
		tools,
		ytDlp: /** @type {any} */ (ytDlp),
		ffmpeg: /** @type {any} */ (ffmpeg),
		fetcher,
		editor: () => editor,
		writeFiles: (task) => {
			additions++;
			return task();
		},
		timers: new FakeClock(),
	});
	/** @type {DownloadEvent[]} */
	const events = [];
	service.onEvent((event) => events.push(event));
	/** @returns {Promise<Job>} */
	const finished = () => new Promise((resolve) => {
		const check = () => {
			const job = service.current();
			if (job && job.state !== 'running') {
				off();
				resolve(job);
			}
		};
		const off = service.onEvent(check);
		check();
	});
	/** @param {string} id */
	const options = async (id) => JSON.parse(await readFile(join(tree.root, ...`${id}.json`.split('/')), 'utf8'));
	return { root: tree.root, library, service, ytDlp, ffmpeg, fetcher, events, finished, options, additions: () => additions };
}

describe('DownloadService', () => {
	describe('looking links up', () => {
		it('treats an audio or video response as a direct file, named from the response', async () => {
			const { service, fetcher, ytDlp } = await setup();
			fetcher.info = { contentType: 'audio/mpeg', size: 1234, name: 'Rain' };
			const probe = await service.probe('https://example.com/get?id=1');
			assert.equal(probe.kind, 'file');
			assert.deepEqual({ ...probe, probeId: undefined }, { kind: 'file', url: 'https://example.com/get?id=1', name: 'Rain.mp3', size: 1234, contentType: 'audio/mpeg', probeId: undefined });
			assert.equal(ytDlp.probes.length, 0);
		});

		it('hands everything else to yt-dlp, and skips the direct check when asked for the playlist', async () => {
			const { service, fetcher, ytDlp } = await setup();
			fetcher.info = { contentType: 'text/html', size: null, name: null };
			assert.equal((await service.probe('https://www.youtube.com/watch?v=zoo')).kind, 'video');
			await service.probe('https://www.youtube.com/watch?v=zoo&list=PL1', { playlist: true });
			assert.deepEqual(ytDlp.probes.map((probe) => probe.playlist), [false, true]);
		});

		it('refuses to look up or download without the tools', async () => {
			const { service } = await setup({ tools: { ytDlp: null, ffmpeg: '7.1' } });
			await assert.rejects(service.probe('https://example.com/'), ToolsUnavailableError);
			assert.throws(() => service.start({ probeId: 'x', target: { kind: 'sound' } }), ToolsUnavailableError);
		});
	});

	describe('downloading', () => {
		it('copies the Opus audio of a whole video into an .opus sound, with its title and source', async () => {
			const { service, ffmpeg, events, finished, options, library, root } = await setup();
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			const started = service.start({ probeId, target: { kind: 'sound' } });
			assert.equal(started.state, 'running');
			assert.equal(started.targetTitle, 'Sound effects');
			const job = await finished();
			assert.equal(job.state, 'done');
			assert.deepEqual(job.items, [{ title: 'Me at the zoo', state: 'done', error: null }]);
			assert.deepEqual(ffmpeg.remuxes, [{ input: 'Me at the zoo [zoo].webm', output: 'Me at the zoo [zoo].opus' }]);
			assert.deepEqual(ffmpeg.conversions, []);
			const saved = await options('Me at the zoo [zoo].opus');
			assert.equal(saved.title, 'Me at the zoo');
			assert.deepEqual(saved.source, { origin: 'download', url: 'https://www.youtube.com/watch?v=zoo', extractor: 'Youtube', videoId: 'zoo' });
			assert.ok(library.sounds.some((sound) => sound.id === 'Me at the zoo [zoo].opus'));
			assert.ok(events.some((event) => event.type === 'library.added' && 'sound' in event));
			assert.deepEqual(await readdir(join(root, WORKSPACE_NAME)), []);
		});

		it("converts a whole video to Ogg Vorbis when its audio can't be copied", async () => {
			const { service, ffmpeg, finished, options } = await setup();
			ffmpeg.remuxFails = true;
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			service.start({ probeId, target: { kind: 'sound' } });
			const job = await finished();
			assert.equal(job.state, 'done');
			assert.deepEqual(ffmpeg.conversions, [{ input: 'Me at the zoo [zoo].webm', output: 'Me at the zoo [zoo].ogg', clip: null }]);
			assert.match(service.current()?.log.join('\n') ?? '', /not Opus/);
			assert.equal((await options('Me at the zoo [zoo].ogg')).title, 'Me at the zoo');
		});

		it('keeps an Opus direct link as it is', async () => {
			const { service, fetcher, ffmpeg, finished } = await setup();
			fetcher.info = { contentType: 'audio/opus', size: 4, name: 'Wind' };
			const { probeId } = await service.probe('https://example.com/Wind');
			service.start({ probeId, target: { kind: 'sound' } });
			const job = await finished();
			assert.equal(job.state, 'done');
			assert.deepEqual(ffmpeg.conversions, []);
			assert.deepEqual(ffmpeg.remuxes, []);
			assert.match(service.current()?.log.join('\n') ?? '', /Wind\.opus/);
		});

		it('cuts the chosen chapters from one download, in order, each with its chapter number and start', async () => {
			const { service, ytDlp, ffmpeg, finished, options } = await setup();
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			service.start({ probeId, target: { kind: 'sound' }, chapters: [2, 0] });
			const job = await finished();
			assert.deepEqual(job.items.map((item) => [item.title, item.state]), [['Intro', 'done'], ['End', 'done']]);
			assert.equal(ytDlp.downloads.length, 1);
			assert.deepEqual(ffmpeg.conversions.map((conversion) => [conversion.output, conversion.clip]), [
				['Me at the zoo - 001 Intro [zoo].ogg', { start: 0, end: 5 }],
				['Me at the zoo - 003 End [zoo].ogg', { start: 17, end: 19 }],
			]);
			const end = await options('Me at the zoo - 003 End [zoo].ogg');
			assert.equal(end.title, 'Me at the zoo - 003 End');
			assert.equal(end.source.chapter, 3);
			assert.equal(end.source.chapterStart, 17);
			assert.equal(end.source.origin, 'download');
		});

		it('downloads the chosen playlist entries into a new playlist, carrying on past a failure', async () => {
			const { service, ytDlp, finished, options, library } = await setup();
			ytDlp.probeResult = PLAYLIST;
			ytDlp.failing.add('b');
			const { probeId } = await service.probe('https://www.youtube.com/playlist?list=PL1');
			service.start({ probeId, target: { kind: 'newPlaylist', title: 'Battle' }, entries: ['a', 'b', 'c'] });
			const job = await finished();
			assert.equal(job.state, 'failed');
			assert.equal(job.added, 2);
			assert.equal(job.failed, 1);
			assert.deepEqual(job.items[1], { title: 'Song b', state: 'failed', error: 'Video b is unavailable' });
			const battle = library.playlists.find((playlist) => playlist.id === 'Battle');
			assert.deepEqual(battle?.tracks.map((track) => track.id), ['Battle/Song a [a].opus', 'Battle/Song c [c].opus']);
			assert.deepEqual((await options('Battle/Song c [c].opus')).source, { origin: 'download', url: 'https://www.youtube.com/watch?v=c', extractor: 'Youtube', videoId: 'c', playlistId: 'PL1' });
		});

		it('keeps an MP3 direct link as it is and records the link', async () => {
			const { service, fetcher, ffmpeg, finished, options, library } = await setup();
			fetcher.info = { contentType: 'audio/mpeg', size: 4, name: 'Rain.mp3' };
			const { probeId } = await service.probe('https://example.com/Rain.mp3');
			service.start({ probeId, target: { kind: 'playlist', playlistId: 'Combat' } });
			const job = await finished();
			assert.equal(job.targetTitle, 'Combat');
			assert.equal(job.state, 'done');
			assert.deepEqual(ffmpeg.conversions, []);
			assert.deepEqual((await options('Combat/Rain.mp3')).source, { origin: 'download', url: 'https://example.com/Rain.mp3' });
			assert.deepEqual(library.playlists.find((playlist) => playlist.id === 'Combat')?.tracks.map((track) => track.id), ['Combat/1.mp3', 'Combat/Rain.mp3']);
			assert.match(service.current()?.log.join('\n') ?? '', /Downloaded 4 B of 4 B \(100 %\)/);
		});

		it('converts other direct files to Ogg', async () => {
			const { service, fetcher, ffmpeg, finished } = await setup();
			fetcher.info = { contentType: 'audio/wav', size: 4, name: 'Thunder.wav' };
			const { probeId } = await service.probe('https://example.com/Thunder.wav');
			service.start({ probeId, target: { kind: 'sound' } });
			await finished();
			assert.deepEqual(ffmpeg.conversions.map((conversion) => conversion.output), ['Thunder.ogg']);
		});

		it('adds every file through writeFiles, so the change watcher records it', async () => {
			const { service, finished, additions } = await setup();
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			service.start({ probeId, target: { kind: 'sound' }, chapters: [0, 1] });
			await finished();
			assert.equal(additions(), 2);
		});
	});

	describe('rules', () => {
		it('runs one job at a time', async () => {
			const { service, ytDlp, finished } = await setup();
			/** @type {() => void} */
			let release = () => {};
			ytDlp.gate = new Promise((resolve) => {
				release = () => resolve();
			});
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			service.start({ probeId, target: { kind: 'sound' } });
			assert.throws(() => service.start({ probeId, target: { kind: 'sound' } }), DownloadBusyError);
			release();
			await finished();
			assert.doesNotThrow(() => service.start({ probeId, target: { kind: 'sound' } }));
			await finished();
		});

		it("rejects requests that don't fit the lookup", async () => {
			const { service, ytDlp } = await setup();
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			assert.throws(() => service.start({ probeId: 'unknown', target: { kind: 'sound' } }), InvalidDownloadError);
			assert.throws(() => service.start({ probeId, target: { kind: 'sound' }, chapters: [] }), /at least one chapter/);
			assert.throws(() => service.start({ probeId, target: { kind: 'sound' }, chapters: [7] }), /at least one chapter/);
			assert.throws(() => service.start({ probeId, target: { kind: 'newPlaylist', title: ' ' } }), /needs a title/);
			assert.throws(() => service.start({ probeId, target: { kind: 'playlist', playlistId: 'Nope' } }), /no longer exists/);
			ytDlp.probeResult = PLAYLIST;
			const list = await service.probe('https://www.youtube.com/playlist?list=PL1');
			assert.throws(() => service.start({ probeId: list.probeId, target: { kind: 'sound' }, entries: ['zzz'] }), /at least one entry/);
		});

		it('cancels: the running step stops, the rest is marked cancelled, and added files stay', async () => {
			const { service, ytDlp, finished, library, root } = await setup();
			ytDlp.probeResult = PLAYLIST;
			const { probeId } = await service.probe('https://www.youtube.com/playlist?list=PL1');
			let downloads = 0;
			const original = ytDlp.download.bind(ytDlp);
			ytDlp.download = async (url, directory, options) => {
				downloads++;
				if (downloads === 2) {
					// Cancelled while the second entry downloads.
					setTimeout(() => service.cancel(), 5);
					ytDlp.gate = new Promise(() => {});
				}
				return original(url, directory, options);
			};
			service.start({ probeId, target: { kind: 'sound' }, entries: ['a', 'b', 'c'] });
			const job = await finished();
			assert.equal(job.state, 'cancelled');
			assert.deepEqual(job.items.map((item) => item.state), ['done', 'cancelled', 'cancelled']);
			assert.ok(library.sounds.some((sound) => sound.id === 'Song a [a].opus'));
			assert.deepEqual(await readdir(join(root, WORKSPACE_NAME)), []);
		});

		it('keeps a finished job until it is dismissed', async () => {
			const { service, events, finished } = await setup();
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			service.start({ probeId, target: { kind: 'sound' } });
			await finished();
			assert.equal(service.current()?.state, 'done');
			service.dismiss();
			assert.equal(service.current(), null);
			assert.deepEqual(events.at(-1), { type: 'download', job: null });
		});
	});

	describe('the log', () => {
		it('starts with each command, replaces progress lines, and sends lines before the state that follows them', async () => {
			const { service, events, finished } = await setup();
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			service.start({ probeId, target: { kind: 'sound' } });
			await finished();
			const log = service.current()?.log ?? [];
			assert.deepEqual(log.slice(0, 2), ['$ yt-dlp https://www.youtube.com/watch?v=zoo', '[download] 100%']);
			assert.equal(log.at(-1), 'Finished: 1 added, 0 failed.');
			// What was sent adds up to the same log.
			/** @type {string[]} */
			const received = [];
			for (const event of events) {
				if (event.type === 'download.log') {
					if (event.replaceLast) {
						received.pop();
					}
					received.push(...event.lines);
				}
			}
			assert.deepEqual(received, log);
			const lastLog = events.findLastIndex((event) => event.type === 'download.log');
			const lastState = events.findLastIndex((event) => event.type === 'download');
			assert.ok(lastLog < lastState);
		});

		it(`keeps the last ${MAX_LOG_LINES} lines`, async () => {
			const { service, ytDlp, finished } = await setup();
			ytDlp.download = async (_url, directory, { onLine }) => {
				for (let index = 0; index < MAX_LOG_LINES + 50; index++) {
					onLine(`line ${index}`, false);
				}
				await writeFile(join(directory, 'x [zoo].webm'), 'webm');
			};
			const { probeId } = await service.probe('https://www.youtube.com/watch?v=zoo');
			service.start({ probeId, target: { kind: 'sound' } });
			await finished();
			assert.equal(service.current()?.log.length, MAX_LOG_LINES);
		});
	});
});
