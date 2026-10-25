import { createInterface } from 'node:readline';

/** @typedef {import('../library/bootstrap-service.js').Prompter} Prompter */

/**
 * Asks y/N questions in the terminal. Anything other than "y" or "yes" means no, as does closed input.
 * Lines typed or piped in ahead of a question are queued, not lost. Call `close()` when done so stdin
 * no longer keeps the process alive.
 * @implements {Prompter}
 */
export class TerminalPrompter {
	#input;
	#output;
	/** @type {import('node:readline').Interface | null} */
	#readline = null;
	/** @type {string[]} */
	#lines = [];
	/** @type {((line: string | null) => void) | null} */
	#waiting = null;
	#closed = false;

	/**
	 * @param {NodeJS.ReadableStream} input
	 * @param {{ write: (chunk: string) => unknown }} output
	 */
	constructor(input, output) {
		this.#input = input;
		this.#output = output;
	}

	/** @param {string} question */
	async confirm(question) {
		this.#output.write(`${question} [y/N] `);
		const answer = await this.#nextLine();
		if (answer === null) {
			this.#output.write('\n');
			return false;
		}
		return /^y(es)?$/i.test(answer.trim());
	}

	close() {
		this.#closed = true;
		this.#readline?.close();
	}

	/** @returns {Promise<string | null>} null once the input has closed */
	#nextLine() {
		this.#listen();
		const queued = this.#lines.shift();
		if (queued !== undefined) {
			return Promise.resolve(queued);
		}
		if (this.#closed) {
			return Promise.resolve(null);
		}
		return new Promise((resolve) => {
			this.#waiting = resolve;
		});
	}

	#listen() {
		if (this.#readline !== null || this.#closed) {
			return;
		}
		// Readline gets no output stream, so it never switches the terminal to raw mode: the terminal itself echoes
		// typing and turns Ctrl+C into SIGINT.
		this.#readline = createInterface({ input: this.#input });
		this.#readline.on('line', (line) => this.#deliver(line));
		this.#readline.on('close', () => {
			this.#closed = true;
			this.#deliver(null);
		});
	}

	/** @param {string | null} line */
	#deliver(line) {
		const waiting = this.#waiting;
		this.#waiting = null;
		if (waiting) {
			waiting(line);
		} else if (line !== null) {
			this.#lines.push(line);
		}
	}
}
