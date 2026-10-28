import { UnusableLinkError } from './errors.js';
import { failureMessage, MAX_ENTRIES, toProbe } from './probe.js';

/** @typedef {import('./process-runner.js').ProcessRunner} ProcessRunner */
/** @typedef {(text: string, transient: boolean) => void} LineListener */

/** yt-dlp's own default name, so the `[id]` part can be recognized later (ROADMAP "Where files came from"). */
export const OUTPUT_TEMPLATE = '%(title)s [%(id)s].%(ext)s';
const FORMAT = 'bestaudio/best';

/**
 * Looks links up and downloads them with `yt-dlp`. The link always follows `--`, so it can never be read as an option.
 */
export class YtDlp {
	#run;

	/** @param {ProcessRunner} run */
	constructor(run) {
		this.#run = run;
	}

	/**
	 * @param {URL} link
	 * @param {{ playlist: boolean }} options without `playlist`, a link that names a video and a playlist means the video
	 * @returns {Promise<import('./probe.js').VideoProbe | import('./probe.js').PlaylistProbe>}
	 */
	async probe(link, { playlist }) {
		/** @type {string[]} */
		const errors = [];
		const args = ['-J', '--flat-playlist', '--playlist-end', String(MAX_ENTRIES), '-f', FORMAT, playlist ? '--yes-playlist' : '--no-playlist', '--', link.href];
		const { code, stdout } = await this.#run('yt-dlp', args, {
			captureStdout: true,
			onLine: (line) => errors.push(line),
		}).done;
		if (code !== 0) {
			throw new UnusableLinkError(failureMessage(errors));
		}
		let info;
		try {
			info = JSON.parse(stdout);
		} catch {
			throw new UnusableLinkError('yt-dlp gave an answer that could not be read.');
		}
		return toProbe(info, link);
	}

	/**
	 * Downloads one video's audio into a directory of its own, so the file it made is the only one there.
	 * @param {string} url
	 * @param {string} directory
	 * @param {{ signal: AbortSignal, onLine: LineListener, onCommand: (line: string) => void }} options
	 */
	async download(url, directory, { signal, onLine, onCommand }) {
		const args = ['-f', FORMAT, '--no-playlist', '--newline', '--no-mtime', '-P', directory, '-o', OUTPUT_TEMPLATE, '--', url];
		onCommand(commandLine('yt-dlp', args));
		/** @type {string[]} */
		const lines = [];
		const running = this.#run('yt-dlp', args, {
			onLine: (text, transient) => {
				lines.push(text);
				onLine(text, transient);
			},
		});
		const stop = () => running.kill();
		signal.addEventListener('abort', stop, { once: true });
		try {
			const { code } = await running.done;
			signal.throwIfAborted();
			if (code !== 0) {
				throw new Error(failureMessage(lines));
			}
		} finally {
			signal.removeEventListener('abort', stop);
		}
	}
}

/**
 * How a command looks in the log: `$ yt-dlp -f bestaudio/best -- 'https://…'`.
 * @param {string} command
 * @param {string[]} args
 */
export function commandLine(command, args) {
	const quote = (/** @type {string} */ arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll('\'', '\'\\\'\'')}'`);
	return `$ ${[command, ...args].map(quote).join(' ')}`;
}
