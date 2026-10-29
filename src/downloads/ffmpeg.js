import { commandLine } from './yt-dlp.js';

/** @typedef {import('./process-runner.js').ProcessRunner} ProcessRunner */

/** Ogg Vorbis quality 5 is about 160 kbps. */
const VORBIS_QUALITY = '5';

/**
 * @typedef {object} ConvertOptions
 * @property {{ start: number, end: number } | null} clip the part of the input to keep, in seconds, for a chapter
 * @property {AbortSignal} signal
 * @property {(text: string, transient: boolean) => void} onLine
 * @property {(line: string) => void} onCommand
 */

/** Encodes audio to Ogg Vorbis with `ffmpeg`, keeping only the first audio stream. */
export class Ffmpeg {
	#run;

	/** @param {ProcessRunner} run */
	constructor(run) {
		this.#run = run;
	}

	/**
	 * @param {string} input
	 * @param {string} output an `.ogg` path
	 * @param {ConvertOptions} options
	 */
	async convert(input, output, { clip, signal, onLine, onCommand }) {
		const args = [
			'-hide_banner',
			'-nostdin',
			'-y',
			// Seeking before the input skips straight there; re-encoding keeps the cut exact anyway.
			...(clip === null ? [] : ['-ss', clip.start.toFixed(3)]),
			'-i', input,
			...(clip === null ? [] : ['-t', (clip.end - clip.start).toFixed(3)]),
			'-map', '0:a:0',
			'-c:a', 'libvorbis',
			'-q:a', VORBIS_QUALITY,
			output,
		];
		await this.#execute(args, { signal, onLine, onCommand });
	}

	/**
	 * Copies the first audio stream into an Ogg file without re-encoding, which only works when it is Opus (or Vorbis).
	 * @param {string} input
	 * @param {string} output an `.opus` path
	 * @param {Omit<ConvertOptions, 'clip'>} options
	 */
	async remux(input, output, { signal, onLine, onCommand }) {
		const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-c:a', 'copy', output];
		await this.#execute(args, { signal, onLine, onCommand });
	}

	/**
	 * @param {string[]} args
	 * @param {Omit<ConvertOptions, 'clip'>} options
	 */
	async #execute(args, { signal, onLine, onCommand }) {
		onCommand(commandLine('ffmpeg', args));
		/** @type {string[]} */
		const lines = [];
		const running = this.#run('ffmpeg', args, {
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
				throw new Error(lines.findLast((line) => line.trim() !== '')?.trim() ?? 'ffmpeg failed without saying why.');
			}
		} finally {
			signal.removeEventListener('abort', stop);
		}
	}
}
