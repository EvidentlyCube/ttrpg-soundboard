import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BootstrapService } from '../library/bootstrap-service.js';
import { parseArguments, USAGE, UsageError } from './args.js';
import { createColors, shouldUseColor } from './colors.js';
import { TerminalPrompter } from './prompter.js';
import { ConsoleReporter } from './reporter.js';

/**
 * @typedef {object} Terminal
 * @property {NodeJS.ReadableStream} input
 * @property {{ write: (chunk: string) => unknown, isTTY?: boolean }} output
 * @property {{ write: (chunk: string) => unknown }} errorOutput
 * @property {Record<string, string | undefined>} env
 */

/**
 * Runs the app from the command line and returns the process exit code.
 * @param {string[]} argv arguments after the script name
 * @param {Terminal} terminal
 * @returns {Promise<number>}
 */
export async function main(argv, { input, output, errorOutput, env }) {
	let args;
	try {
		args = parseArguments(argv);
	} catch (error) {
		if (!(error instanceof UsageError)) {
			throw error;
		}
		errorOutput.write(`${error.message}\n\n${USAGE}\n`);
		return 1;
	}

	const root = resolve(args.directory);
	if (!(await isDirectory(root))) {
		errorOutput.write(`Not a directory: ${args.directory}\n\n${USAGE}\n`);
		return 1;
	}

	const reporter = new ConsoleReporter(output, createColors(shouldUseColor(output, env)), root);
	const prompter = new TerminalPrompter(input, output);
	let outcome;
	try {
		outcome = await new BootstrapService({ prompter, reporter }).run(root);
	} finally {
		prompter.close();
	}
	if (outcome.status === 'invalid') {
		return 1;
	}
	return 0;
}

/** @param {string} path */
async function isDirectory(path) {
	return stat(path).then((stats) => stats.isDirectory(), () => false);
}
