import { ToolMissingError } from './errors.js';

/** @typedef {import('./process-runner.js').ProcessRunner} ProcessRunner */
/** @typedef {{ ytDlp: string | null, ffmpeg: string | null }} Tools the version of each program, or null when missing */

/**
 * Finds out which of the programs downloads need are installed (DESIGN.md §5.4).
 * @param {ProcessRunner} run
 * @returns {Promise<Tools>}
 */
export async function findTools(run) {
	const [ytDlp, ffmpeg] = await Promise.all([
		versionOf(run, 'yt-dlp', ['--version'], (output) => output.trim().split('\n')[0]),
		// "ffmpeg version 7.1.1 Copyright (c) …"
		versionOf(run, 'ffmpeg', ['-version'], (output) => /^ffmpeg version (\S+)/.exec(output)?.[1] ?? null),
	]);
	return { ytDlp, ffmpeg };
}

/**
 * @param {Tools} tools
 * @returns {string[]} the programs that are missing
 */
export function missingTools(tools) {
	return [...(tools.ytDlp === null ? ['yt-dlp'] : []), ...(tools.ffmpeg === null ? ['ffmpeg'] : [])];
}

/**
 * The startup line about downloads.
 * @param {Tools} tools
 */
export function describeTools(tools) {
	const missing = missingTools(tools);
	if (missing.length > 0) {
		return `Downloads are off: ${missing.join(' and ')} ${missing.length === 1 ? 'was' : 'were'} not found.`;
	}
	return `Downloads: yt-dlp ${tools.ytDlp}, ffmpeg ${tools.ffmpeg}`;
}

/**
 * @param {ProcessRunner} run
 * @param {string} command
 * @param {string[]} args
 * @param {(output: string) => string | null | undefined} parse
 * @returns {Promise<string | null>}
 */
async function versionOf(run, command, args, parse) {
	try {
		const { code, stdout } = await run(command, args, { captureStdout: true }).done;
		return code === 0 ? (parse(stdout) || 'unknown version') : null;
	} catch (error) {
		if (error instanceof ToolMissingError) {
			return null;
		}
		throw error;
	}
}
