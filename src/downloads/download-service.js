import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DownloadBusyError, InvalidDownloadError, ToolsUnavailableError, UnusableLinkError } from './errors.js';
import { chapterFileName, safeFileName, titleFromFileName, withExtension } from './file-names.js';
import { parseLink } from './probe.js';
import { missingTools } from './tools.js';
import { workspaceOf } from './workspace.js';

/** @typedef {import('./probe.js').Probe} Probe */
/** @typedef {import('./probe.js').Chapter} Chapter */
/** @typedef {import('./tools.js').Tools} Tools */
/** @typedef {import('./link-fetcher.js').LinkFetcher} LinkFetcher */
/** @typedef {import('./yt-dlp.js').YtDlp} YtDlp */
/** @typedef {import('./ffmpeg.js').Ffmpeg} Ffmpeg */
/** @typedef {import('../library/library-editor.js').LibraryEditor} LibraryEditor */
/** @typedef {import('../library/library.js').AudioFile} AudioFile */
/** @typedef {import('../library/library.js').Playlist} Playlist */
/** @typedef {import('../library/validate.js').Source} Source */

/** @typedef {{ kind: 'sound' } | { kind: 'newPlaylist', title: string } | { kind: 'playlist', playlistId: string }} Target */
/** @typedef {'waiting' | 'downloading' | 'converting' | 'done' | 'failed' | 'cancelled'} ItemState */
/** @typedef {{ title: string, state: ItemState, error: string | null }} JobItem */

/**
 * @typedef {object} Job what the page shows about a download; JSON-safe
 * @property {string} id
 * @property {string} title what was looked up
 * @property {Target} target
 * @property {string} targetTitle "Sound effects", or the playlist's title
 * @property {'running' | 'done' | 'failed' | 'cancelled'} state `failed` when any item failed
 * @property {JobItem[]} items one per file it adds
 * @property {number | null} current the index of the item being worked on
 * @property {number} added
 * @property {number} failed
 */

/**
 * @typedef {{ type: 'download', job: Job | null }
 * 	| { type: 'download.log', lines: string[], replaceLast: boolean }
 * 	| { type: 'library.added', sound: AudioFile }
 * 	| { type: 'library.added', playlist: Playlist }} DownloadEvent
 * 	`replaceLast`: the first line replaces the last one already sent
 */

/**
 * @typedef {object} StartRequest
 * @property {string} probeId from `probe`
 * @property {Target} target
 * @property {number[] | null} [chapters] indices of the chapters to cut a video into; null or missing keeps it whole
 * @property {string[]} [entries] ids of the playlist entries to download
 */

/**
 * @typedef {object} Output one file a download is turned into
 * @property {number} item
 * @property {{ number: number, chapter: Chapter } | null} chapter
 */
/**
 * @typedef {object} Fetch one thing to download
 * @property {'file' | 'yt-dlp'} via
 * @property {string} url
 * @property {string | null} videoId
 * @property {Omit<Source, 'chapter'>} source
 * @property {{ name: string, size: number | null } | null} file what a direct link said about itself
 * @property {Output[]} outputs
 */

/** How many lines of program output a job keeps. */
export const MAX_LOG_LINES = 1000;
/** How often log lines are sent to the page at most. */
const LOG_BATCH_MS = 250;
/** Lookups are remembered so a download can refer to them; only the latest few are kept. */
const MAX_PROBES = 10;
const KEPT_EXTENSIONS = new Set(['.mp3', '.ogg', '.opus']);
/** Containers YouTube serves Opus in; tried as a lossless copy into `.opus` before re-encoding. */
const REMUXABLE_EXTENSIONS = new Set(['.webm', '.weba']);
/** Leftovers of an interrupted yt-dlp download, never the result. */
const PARTIAL_EXTENSIONS = new Set(['.part', '.ytdl', '.temp']);
const CONTENT_TYPE_EXTENSIONS = /** @type {Record<string, string>} */ ({ 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'audio/opus': '.opus' });

/**
 * Looks links up and downloads them into the library, one job at a time (DESIGN.md §5.4). Jobs live in memory only;
 * a finished one stays until it is dismissed, so its summary survives a page reload.
 */
export class DownloadService {
	#root;
	#tools;
	#ytDlp;
	#ffmpeg;
	#fetcher;
	#editor;
	#writeFiles;
	#timers;
	/** @type {Set<(event: DownloadEvent) => void>} */
	#listeners = new Set();
	/** @type {Map<string, Probe>} */
	#probes = new Map();
	/** @type {Job | null} */
	#job = null;
	/** @type {string[]} */
	#log = [];
	#lastLineTransient = false;
	/** @type {{ lines: string[], replaceLast: boolean }} */
	#pendingLog = { lines: [], replaceLast: false };
	/** @type {unknown} */
	#logTimer = null;
	/** @type {AbortController | null} */
	#abort = null;

	/**
	 * @param {object} options
	 * @param {string} options.root
	 * @param {Tools} options.tools
	 * @param {YtDlp} options.ytDlp
	 * @param {Ffmpeg} options.ffmpeg
	 * @param {LinkFetcher} options.fetcher
	 * @param {() => LibraryEditor} options.editor the current one; a refresh replaces it
	 * @param {<T extends { written: string[] }>(task: () => Promise<T>) => Promise<T>} options.writeFiles runs an addition
	 * 	so the change watcher records its files
	 * @param {Pick<import('../library/change-watcher.js').Timers, 'setTimeout' | 'clearTimeout'>} [options.timers]
	 */
	constructor({ root, tools, ytDlp, ffmpeg, fetcher, editor, writeFiles, timers = { setTimeout, clearTimeout } }) {
		this.#root = root;
		this.#tools = tools;
		this.#ytDlp = ytDlp;
		this.#ffmpeg = ffmpeg;
		this.#fetcher = fetcher;
		this.#editor = editor;
		this.#writeFiles = writeFiles;
		this.#timers = timers;
	}

	get tools() {
		return this.#tools;
	}

	/**
	 * @param {(event: DownloadEvent) => void} listener
	 * @returns {() => void} unsubscribes
	 */
	onEvent(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** @returns {(Job & { log: string[] }) | null} the current job with its whole log */
	current() {
		return this.#job && { ...structuredClone(this.#job), log: [...this.#log] };
	}

	/**
	 * Finds out what a link holds. A direct link to an audio or video file is a file; anything else is up to yt-dlp.
	 * @param {string} text the link
	 * @param {{ playlist?: boolean }} [options] look a link that names a video and a playlist up as the playlist
	 * @returns {Promise<Probe & { probeId: string }>}
	 */
	async probe(text, { playlist = false } = {}) {
		this.#requireTools();
		const link = parseLink(text);
		/** @type {Probe | null} */
		let probe = null;
		if (!playlist) {
			const info = await this.#fetcher.inspect(link.href);
			if (info && (info.contentType.startsWith('audio/') || info.contentType.startsWith('video/'))) {
				const extension = CONTENT_TYPE_EXTENSIONS[info.contentType] ?? '';
				const name = info.name ?? 'download';
				probe = {
					kind: 'file',
					url: link.href,
					name: extname(name) === '' ? `${name}${extension}` : name,
					size: info.size,
					contentType: info.contentType,
				};
			}
		}
		probe ??= await this.#ytDlp.probe(link, { playlist });
		const probeId = randomUUID();
		this.#probes.set(probeId, probe);
		for (const id of [...this.#probes.keys()].slice(0, -MAX_PROBES)) {
			this.#probes.delete(id);
		}
		return { ...probe, probeId };
	}

	/**
	 * Starts downloading what a lookup found. It runs in the background; follow it with `onEvent`.
	 * @param {StartRequest} request
	 * @returns {Job}
	 */
	start(request) {
		this.#requireTools();
		if (this.#job?.state === 'running') {
			throw new DownloadBusyError();
		}
		const probe = this.#probes.get(request.probeId);
		if (!probe) {
			throw new InvalidDownloadError('That lookup is too old. Look the link up again.', 'download.oldLookup');
		}
		const targetTitle = this.#targetTitle(request.target);
		const { items, fetches } = plan(probe, request);
		this.#job = {
			id: randomUUID(),
			title: probe.kind === 'file' ? probe.name : probe.title,
			target: request.target,
			targetTitle,
			state: 'running',
			items,
			current: null,
			added: 0,
			failed: 0,
		};
		this.#log = [];
		this.#lastLineTransient = false;
		this.#pendingLog = { lines: [], replaceLast: false };
		this.#abort = new AbortController();
		this.#announce();
		this.#run(this.#job, fetches, this.#abort.signal);
		return structuredClone(this.#job);
	}

	/** Stops the running job; files already added stay. */
	cancel() {
		this.#abort?.abort();
	}

	/** Cancels a running job, or forgets a finished one. */
	dismiss() {
		if (this.#job?.state === 'running') {
			this.cancel();
			return;
		}
		if (this.#job) {
			this.#job = null;
			this.#log = [];
			this.#announce();
		}
	}

	#requireTools() {
		const missing = missingTools(this.#tools);
		if (missing.length > 0) {
			throw new ToolsUnavailableError(missing);
		}
	}

	/** @param {Target} target */
	#targetTitle(target) {
		switch (target.kind) {
			case 'sound':
				return 'Sound effects';
			case 'newPlaylist':
				if (typeof target.title !== 'string' || target.title.trim() === '') {
					throw new InvalidDownloadError('The new playlist needs a title.', 'download.noTitle');
				}
				return target.title.trim();
			case 'playlist': {
				const playlist = this.#editor().playlist(target.playlistId);
				if (!playlist) {
					throw new InvalidDownloadError('That playlist no longer exists.', 'download.playlistGone');
				}
				return playlist.title;
			}
			default:
				throw new InvalidDownloadError('Unknown target.', 'download.unknownTarget');
		}
	}

	/**
	 * @param {Job} job
	 * @param {Fetch[]} fetches
	 * @param {AbortSignal} signal
	 */
	async #run(job, fetches, signal) {
		const workspace = join(workspaceOf(this.#root), job.id);
		/** @type {string | null} the playlist a `newPlaylist` job created with its first file */
		let createdPlaylist = null;
		try {
			for (const [index, fetch] of fetches.entries()) {
				if (signal.aborted) {
					break;
				}
				const directory = join(workspace, String(index));
				await mkdir(join(directory, 'out'), { recursive: true });
				this.#setItems(job, fetch.outputs, 'downloading');
				let downloaded;
				try {
					downloaded = await this.#download(fetch, directory, signal);
				} catch (error) {
					if (signal.aborted) {
						break;
					}
					this.#fail(job, fetch.outputs, error);
					continue;
				}
				for (const output of fetch.outputs) {
					if (signal.aborted) {
						break;
					}
					try {
						const prepared = await this.#prepare(downloaded, fetch, output, directory, job, signal);
						const options = {
							title: titleFromFileName(prepared.name, fetch.videoId),
							source: {
								origin: /** @type {const} */ ('download'),
								...fetch.source,
								// The start lets the metadata dialog link to the chapter (DESIGN.md §9.13).
								...(output.chapter ? { chapter: output.chapter.number, chapterStart: Math.round(output.chapter.chapter.start * 1000) / 1000 } : {}),
							},
						};
						createdPlaylist = await this.#add(job.target, createdPlaylist, prepared.path, prepared.name, options);
						job.items[output.item].state = 'done';
						job.added++;
						this.#announce();
					} catch (error) {
						if (signal.aborted) {
							break;
						}
						this.#fail(job, [output], error);
					}
				}
			}
		} catch (error) {
			this.#writeLog(`Download failed: ${messageOf(error)}`, false);
		} finally {
			await rm(workspace, { recursive: true, force: true }).catch(() => {});
			for (const item of job.items) {
				if (item.state === 'waiting' || item.state === 'downloading' || item.state === 'converting') {
					item.state = signal.aborted ? 'cancelled' : 'failed';
				}
			}
			job.failed = job.items.filter((item) => item.state === 'failed').length;
			job.state = signal.aborted ? 'cancelled' : job.failed > 0 ? 'failed' : 'done';
			job.current = null;
			this.#writeLog(signal.aborted ? 'Cancelled.' : `Finished: ${job.added} added, ${job.failed} failed.`, false);
			this.#abort = null;
			this.#announce();
		}
	}

	/**
	 * @param {Fetch} fetch
	 * @param {string} directory
	 * @param {AbortSignal} signal
	 * @returns {Promise<{ path: string, name: string }>}
	 */
	async #download(fetch, directory, signal) {
		const onLine = (/** @type {string} */ text, /** @type {boolean} */ transient) => this.#writeLog(text, transient);
		const onCommand = (/** @type {string} */ line) => this.#writeLog(line, false);
		if (fetch.via === 'yt-dlp') {
			await this.#ytDlp.download(fetch.url, directory, { signal, onLine, onCommand });
			const names = (await readdir(directory, { withFileTypes: true }))
				.filter((entry) => entry.isFile() && !PARTIAL_EXTENSIONS.has(extname(entry.name).toLowerCase()))
				.map((entry) => entry.name);
			if (names.length !== 1) {
				throw new Error(names.length === 0 ? 'yt-dlp finished without saving a file.' : 'yt-dlp saved more than one file.');
			}
			return { path: join(directory, names[0]), name: names[0] };
		}
		const { size } = /** @type {{ name: string, size: number | null }} */ (fetch.file);
		const name = safeFileName(/** @type {{ name: string }} */ (fetch.file).name);
		const path = join(directory, name);
		onCommand(`Downloading ${fetch.url}`);
		let lastReport = -1;
		/** @param {number} received */
		const progress = (received) => `Downloaded ${formatBytes(received)}${size ? ` of ${formatBytes(size)} (${Math.floor(received / size * 100)} %)` : ''}`;
		let total = 0;
		await this.#fetcher.download(fetch.url, path, {
			signal,
			expectedSize: size,
			onProgress: (received) => {
				total = received;
				// A line per percent, or per megabyte when the size is unknown, is plenty.
				const step = size ? Math.floor(received / size * 100) : Math.floor(received / 1_000_000);
				if (step !== lastReport) {
					lastReport = step;
					this.#writeLog(progress(received), true);
				}
			},
		});
		this.#writeLog(progress(total), false);
		return { path, name };
	}

	/**
	 * Turns a download into one `.mp3` or `.ogg` file for one output, converting or cutting it when needed.
	 * @param {{ path: string, name: string }} downloaded
	 * @param {Fetch} fetch
	 * @param {Output} output
	 * @param {string} directory
	 * @param {Job} job
	 * @param {AbortSignal} signal
	 * @returns {Promise<{ path: string, name: string }>}
	 */
	async #prepare(downloaded, fetch, output, directory, job, signal) {
		if (output.chapter === null && KEPT_EXTENSIONS.has(extname(downloaded.name).toLowerCase())) {
			job.current = output.item;
			return downloaded;
		}
		this.#setItems(job, [output], 'converting');
		const callbacks = {
			signal,
			onLine: (/** @type {string} */ text, /** @type {boolean} */ transient) => this.#writeLog(text, transient),
			onCommand: (/** @type {string} */ line) => this.#writeLog(line, false),
		};
		if (output.chapter === null && REMUXABLE_EXTENSIONS.has(extname(downloaded.name).toLowerCase())) {
			const opusName = safeFileName(withExtension(downloaded.name, '.opus'));
			const opusPath = join(directory, 'out', opusName);
			try {
				await this.#ffmpeg.remux(downloaded.path, opusPath, callbacks);
				return { path: opusPath, name: opusName };
			} catch {
				signal.throwIfAborted();
				this.#writeLog('The audio is not Opus, so it is converted to Ogg Vorbis instead.', false);
			}
		}
		const name = output.chapter
			? chapterFileName(downloaded.name, output.chapter.number, output.chapter.chapter.title, fetch.videoId ?? '')
			: safeFileName(withExtension(downloaded.name, '.ogg'));
		const path = join(directory, 'out', name);
		await this.#ffmpeg.convert(downloaded.path, path, {
			clip: output.chapter && { start: output.chapter.chapter.start, end: output.chapter.chapter.end },
			...callbacks,
		});
		return { path, name };
	}

	/**
	 * @param {Target} target
	 * @param {string | null} createdPlaylist
	 * @param {string} path
	 * @param {string} name
	 * @param {import('../library/library-editor.js').NewFileOptions} options
	 * @returns {Promise<string | null>} the playlist a `newPlaylist` job adds to from now on
	 */
	async #add(target, createdPlaylist, path, name, options) {
		if (target.kind === 'sound') {
			const { sound } = await this.#writeFiles(() => this.#editor().addSound(path, name, options));
			this.#writeLog(`Added the sound "${sound.title}" (${sound.id})`, false);
			this.#emit({ type: 'library.added', sound });
			return null;
		}
		const playlistId = target.kind === 'playlist' ? target.playlistId : createdPlaylist;
		const { playlist, track } = await this.#writeFiles(() => (playlistId === null
			? this.#editor().createPlaylist(/** @type {{ title: string }} */ (target).title, path, name, options)
			: this.#editor().addTrack(playlistId, path, name, options)));
		this.#writeLog(`Added "${track.title}" to ${playlist.title} (${track.id})`, false);
		this.#emit({ type: 'library.added', playlist });
		return playlist.id;
	}

	/**
	 * @param {Job} job
	 * @param {Output[]} outputs
	 * @param {ItemState} state
	 */
	#setItems(job, outputs, state) {
		for (const output of outputs) {
			job.items[output.item].state = state;
		}
		job.current = outputs[0]?.item ?? null;
		this.#announce();
	}

	/**
	 * @param {Job} job
	 * @param {Output[]} outputs
	 * @param {unknown} error
	 */
	#fail(job, outputs, error) {
		const message = messageOf(error);
		this.#writeLog(`Failed: ${message}`, false);
		for (const output of outputs) {
			Object.assign(job.items[output.item], { state: 'failed', error: message });
		}
		this.#announce();
	}

	/**
	 * Adds a line to the log. A line after a transient one replaces it, as a terminal shows progress.
	 * @param {string} text
	 * @param {boolean} transient
	 */
	#writeLog(text, transient) {
		const replace = this.#lastLineTransient && this.#log.length > 0;
		this.#lastLineTransient = transient;
		const pending = this.#pendingLog;
		if (replace) {
			this.#log[this.#log.length - 1] = text;
			if (pending.lines.length > 0) {
				pending.lines[pending.lines.length - 1] = text;
			} else {
				pending.lines.push(text);
				pending.replaceLast = true;
			}
		} else {
			this.#log.push(text);
			pending.lines.push(text);
			if (this.#log.length > MAX_LOG_LINES) {
				this.#log.splice(0, this.#log.length - MAX_LOG_LINES);
			}
		}
		this.#logTimer ??= this.#timers.setTimeout(() => this.#flushLog(), LOG_BATCH_MS);
	}

	#flushLog() {
		this.#timers.clearTimeout(this.#logTimer);
		this.#logTimer = null;
		const { lines, replaceLast } = this.#pendingLog;
		if (lines.length === 0) {
			return;
		}
		this.#pendingLog = { lines: [], replaceLast: false };
		this.#emit({ type: 'download.log', lines, replaceLast });
	}

	/** Sends the job's state, after any log lines still waiting, so the page sees them in order. */
	#announce() {
		this.#flushLog();
		this.#emit({ type: 'download', job: this.#job && structuredClone(this.#job) });
	}

	/** @param {DownloadEvent} event */
	#emit(event) {
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

/**
 * Works out the items a job shows and what it downloads for them.
 * @param {Probe} probe
 * @param {StartRequest} request
 * @returns {{ items: JobItem[], fetches: Fetch[] }}
 */
function plan(probe, request) {
	/** @param {string} title */
	const item = (title) => ({ title, state: /** @type {ItemState} */ ('waiting'), error: null });
	/** @param {Record<string, string | null>} fields */
	const sourceOf = (fields) => /** @type {Omit<Source, 'chapter'>} */ (Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)));
	switch (probe.kind) {
		case 'file':
			return {
				items: [item(probe.name)],
				fetches: [{
					via: 'file',
					url: probe.url,
					videoId: null,
					source: { url: probe.url },
					file: { name: probe.name, size: probe.size },
					outputs: [{ item: 0, chapter: null }],
				}],
			};
		case 'video': {
			const source = sourceOf({ url: probe.url, extractor: probe.extractor, videoId: probe.id });
			const chapters = request.chapters ?? null;
			if (chapters === null) {
				return { items: [item(probe.title)], fetches: [{ via: 'yt-dlp', url: probe.url, videoId: probe.id, source, file: null, outputs: [{ item: 0, chapter: null }] }] };
			}
			if (
				!Array.isArray(chapters)
				|| chapters.length === 0
				|| new Set(chapters).size !== chapters.length
				|| !chapters.every((index) => Number.isInteger(index) && index >= 0 && index < probe.chapters.length)
			) {
				throw new InvalidDownloadError('Choose at least one chapter.', 'download.noChapter');
			}
			const sorted = chapters.toSorted((a, b) => a - b);
			return {
				items: sorted.map((index) => item(probe.chapters[index].title)),
				fetches: [{
					via: 'yt-dlp',
					url: probe.url,
					videoId: probe.id,
					source,
					file: null,
					outputs: sorted.map((index, position) => ({ item: position, chapter: { number: index + 1, chapter: probe.chapters[index] } })),
				}],
			};
		}
		case 'playlist': {
			const wanted = new Set(Array.isArray(request.entries) ? request.entries : []);
			const entries = probe.entries.filter((entry) => wanted.has(entry.id));
			if (entries.length === 0) {
				throw new InvalidDownloadError('Choose at least one entry.', 'download.noEntry');
			}
			return {
				items: entries.map((entry) => item(entry.title)),
				fetches: entries.map((entry, position) => ({
					via: 'yt-dlp',
					url: entry.url,
					videoId: entry.id,
					source: sourceOf({ url: entry.url, extractor: entry.extractor, videoId: entry.id, playlistId: probe.id }),
					file: null,
					outputs: [{ item: position, chapter: null }],
				})),
			};
		}
		default:
			throw new UnusableLinkError('Unknown kind of link.', 'link.unknownKind');
	}
}

/** @param {unknown} error */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}

/** @param {number} bytes */
export function formatBytes(bytes) {
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit++;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
