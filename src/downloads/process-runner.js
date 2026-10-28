import { spawn } from 'node:child_process';
import { LineSplitter } from './line-splitter.js';
import { ToolMissingError } from './errors.js';

/**
 * @typedef {object} RunOptions
 * @property {string} [cwd]
 * @property {(text: string, transient: boolean) => void} [onLine] every line of stderr, and of stdout unless captured
 * @property {boolean} [captureStdout] collect stdout as a whole instead of passing it to `onLine`
 */

/** @typedef {{ code: number | null, signal: string | null, stdout: string }} RunResult */

/**
 * @typedef {object} RunningProcess
 * @property {Promise<RunResult>} done rejects with a ToolMissingError when the program isn't installed
 * @property {() => void} kill stops the program and every process it started
 */

/** @typedef {(command: string, args: string[], options?: RunOptions) => RunningProcess} ProcessRunner */

/**
 * Starts a program with an argument list, never through a shell, so nothing in a link can be read as shell syntax.
 * @type {ProcessRunner}
 */
export function runProcess(command, args, { cwd, onLine = () => {}, captureStdout = false } = {}) {
	// Its own process group, so killing it also stops the ffmpeg that yt-dlp starts.
	const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
	let stdout = '';
	const errorLines = new LineSplitter(onLine);
	const outputLines = new LineSplitter(onLine);
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		if (captureStdout) {
			stdout += chunk;
		} else {
			outputLines.push(chunk);
		}
	});
	child.stderr.on('data', (chunk) => errorLines.push(chunk));

	/** @type {Promise<RunResult>} */
	const done = new Promise((resolve, reject) => {
		child.once('error', (error) => {
			reject(/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT' ? new ToolMissingError(command) : error);
		});
		child.once('close', (code, signal) => {
			outputLines.end();
			errorLines.end();
			resolve({ code, signal, stdout });
		});
	});
	return {
		done,
		kill: () => {
			if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
				return;
			}
			try {
				process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
			} catch {
				// Already gone.
			}
		},
	};
}
