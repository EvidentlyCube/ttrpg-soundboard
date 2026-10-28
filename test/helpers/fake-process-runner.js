import { ToolMissingError } from '../../src/downloads/errors.js';

/** @typedef {import('../../src/downloads/process-runner.js').RunOptions} RunOptions */
/** @typedef {import('../../src/downloads/process-runner.js').RunResult} RunResult */

/**
 * What a fake program can do while it "runs".
 * @typedef {object} FakeProcess
 * @property {(text: string, transient?: boolean) => void} line prints a line, to stderr or uncaptured stdout
 * @property {AbortSignal} killed aborted once the program is killed
 * @property {RunOptions} options
 */

/**
 * @typedef {(command: string, args: string[], process: FakeProcess) => Promise<Partial<RunResult> | 'missing'>
 * 	| Partial<RunResult> | 'missing'} FakeProgram `'missing'` behaves like a program that isn't installed
 */

/**
 * Stands in for `runProcess`: each run is answered by `program`, and every call is recorded.
 * @param {FakeProgram} program
 */
export function fakeProcessRunner(program) {
	/** @type {{ command: string, args: string[], options: RunOptions, killed: boolean }[]} */
	const calls = [];
	/** @type {import('../../src/downloads/process-runner.js').ProcessRunner} */
	const run = (command, args, options = {}) => {
		const controller = new AbortController();
		const call = { command, args, options, killed: false };
		calls.push(call);
		const done = Promise.resolve(program(command, args, {
			line: (text, transient = false) => options.onLine?.(text, transient),
			killed: controller.signal,
			options,
		})).then((result) => {
			if (result === 'missing') {
				throw new ToolMissingError(command);
			}
			return { code: 0, signal: null, stdout: '', ...result };
		});
		return {
			done,
			kill: () => {
				call.killed = true;
				controller.abort();
			},
		};
	};
	return { run, calls };
}

/**
 * Resolves once the signal is aborted, like a program that runs until it is killed.
 * @param {AbortSignal} signal
 * @returns {Promise<Partial<RunResult>>}
 */
export function untilKilled(signal) {
	return new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve({ code: null, signal: 'SIGTERM' }), { once: true });
	});
}
