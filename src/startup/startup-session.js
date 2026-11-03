import { rm } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import {
	LARGE_FOLDER_QUESTION,
	METADATA_TITLES_QUESTION,
	NESTED_DIRECTORIES_QUESTION,
} from '../library/bootstrap-service.js';
import { FolderRefusedError, StartupStateError } from './errors.js';
import { checkFolder } from './folder-rules.js';

/** @typedef {import('../library/bootstrap-service.js').Prompter} Prompter */
/** @typedef {import('../library/bootstrap-service.js').Reporter} Reporter */
/** @typedef {import('../library/errors.js').ValidationError} ValidationError */
/** @typedef {import('./folder-rules.js').Platform} Platform */
/** @typedef {import('./recent-folders.js').RecentFolders} RecentFolders */

/**
 * The loaded soundboard as the server sees it: whatever answers its requests, and how to close it.
 * @typedef {object} Board
 * @property {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>} handle
 * @property {() => Promise<void>} close
 */

/**
 * What opening a folder came to. `start` builds the board once the tools are ready.
 * @typedef {{ status: 'ready', start: () => Promise<Board> }
 * 	| { status: 'invalid', errors: ValidationError[] }
 * 	| { status: 'cancelled' }} OpenOutcome
 */

/** @typedef {(root: string, ports: { prompter: Prompter, reporter: Reporter }) => Promise<OpenOutcome>} Opener */

/** @typedef {'selecting' | 'initializing' | 'ready'} Phase */

/**
 * @typedef {{ id: number, kind: 'largeFolder', count: number }
 * 	| { id: number, kind: 'nestedDirectories', paths: string[] }
 * 	| { id: number, kind: 'metadataTitles', titles: { path: string, title: string }[] }} Question
 */

/**
 * What the Initializer shows (DESIGN.md §3).
 * @typedef {object} InitializerState
 * @property {string} root
 * @property {'scanning' | 'question' | 'measuring' | 'waitingForTools' | 'starting' | 'failed'} step
 * @property {Question | null} question
 * @property {{ done: number, total: number } | null} progress while measuring durations
 * @property {{ path: string, problems: string[] }[]} failures the files that failed validation, relative to the root
 * @property {string | null} error what went wrong otherwise, such as a folder that can't be read
 * @property {boolean} canDelete whether every failure is a file that may be deleted
 */

/**
 * @typedef {object} StartupState
 * @property {Phase} phase
 * @property {{ path: string, name: string, allowed: boolean, reason: string | null }[] | null} paths the folders given on
 * 	the command line, the only ones that may be opened; null when none were
 * @property {{ path: string, name: string, exists: boolean }[]} recent empty when paths were given
 * @property {InitializerState | null} initializer
 */

/** @type {Record<string, Question['kind']>} */
const QUESTION_KINDS = {
	[LARGE_FOLDER_QUESTION]: 'largeFolder',
	[NESTED_DIRECTORIES_QUESTION]: 'nestedDirectories',
	[METADATA_TITLES_QUESTION]: 'metadataTitles',
};

export const ONLY_GIVEN_PATHS = 'Only the folders given when the app was started can be opened.';

/**
 * The server's phase (DESIGN.md §3): choosing a folder, loading it with the user's answers, then the soundboard. It is
 * the bootstrap's `Prompter` and `Reporter` while loading, keeping what they receive for the Initializer page. Every
 * load has its own generation, so the answers and reports of one that was abandoned are ignored.
 */
export class StartupSession {
	#paths;
	#recent;
	#platform;
	#open;
	#deleteFile;
	#logError;
	#toolsDone = false;
	#toolsReady;
	/** @type {Phase} */
	#phase = 'selecting';
	/** @type {InitializerState | null} */
	#initializer = null;
	/** @type {Board | null} */
	#board = null;
	#generation = 0;
	#questionIds = 0;
	/** @type {((yes: boolean) => void) | null} */
	#answer = null;
	/** @type {{ kind: 'largeFolder', count: number } | { kind: 'nestedDirectories', paths: string[] } | { kind: 'metadataTitles', titles: { path: string, title: string }[] } | null} */
	#details = null;
	/** @type {ValidationError[]} */
	#errors = [];

	/**
	 * @param {object} options
	 * @param {string[] | null} options.paths absolute folders from the command line, or null
	 * @param {RecentFolders} options.recent
	 * @param {Platform} options.platform
	 * @param {Opener} options.open loads a folder, asking and reporting through the given ports
	 * @param {Promise<unknown>} options.toolsReady settles once the download tools were looked for and updated
	 * @param {(error: unknown) => void} options.logError
	 * @param {(path: string) => Promise<void>} [options.deleteFile]
	 */
	constructor({ paths, recent, platform, open, toolsReady, logError, deleteFile = (path) => rm(path, { force: true }) }) {
		this.#paths = paths;
		this.#recent = recent;
		this.#platform = platform;
		this.#open = open;
		this.#logError = logError;
		this.#deleteFile = deleteFile;
		this.#toolsReady = toolsReady.finally(() => {
			this.#toolsDone = true;
		});
		this.#toolsReady.catch(() => {});
	}

	/** @returns {Phase} */
	get phase() {
		return this.#phase;
	}

	/** @returns {Board | null} the soundboard while the phase is `ready` */
	get board() {
		return this.#board;
	}

	/** @returns {Promise<StartupState>} */
	async state() {
		const paths = this.#paths && await Promise.all(this.#paths.map(async (path) => ({
			path,
			name: basename(path) || path,
			...(await checkFolder(path, this.#platform)),
		})));
		const recent = this.#paths ? [] : await this.#recent.list();
		return {
			phase: this.#phase,
			paths,
			recent: recent.map((folder) => ({ ...folder, name: basename(folder.path) || folder.path })),
			initializer: this.#initializer && { ...this.#initializer },
		};
	}

	/**
	 * Starts loading a folder.
	 * @param {string} path absolute
	 * @throws {StartupStateError} unless a folder is being chosen
	 * @throws {FolderRefusedError}
	 */
	async select(path) {
		this.#expectPhase('selecting');
		if (!isAbsolute(path)) {
			throw new FolderRefusedError('Give the whole path of the folder.');
		}
		const root = resolve(path);
		if (this.#paths && !this.#paths.includes(root)) {
			throw new FolderRefusedError(ONLY_GIVEN_PATHS);
		}
		const check = await checkFolder(root, this.#platform);
		if (!check.allowed) {
			throw new FolderRefusedError(check.reason);
		}
		// Checked again: another page may have chosen a folder while this one was checked.
		this.#expectPhase('selecting');
		this.#load(root);
	}

	/**
	 * @param {number} id the question's id, so an answer to an older question is refused
	 * @param {boolean} yes
	 */
	answer(id, yes) {
		const initializer = this.#initializer;
		if (initializer?.step !== 'question' || initializer.question?.id !== id || !this.#answer) {
			throw new StartupStateError('That question is no longer asked.');
		}
		const resolveAnswer = this.#answer;
		this.#answer = null;
		this.#update({ step: 'scanning', question: null });
		resolveAnswer(yes);
	}

	/** Back to choosing a folder, from a question (answering No) or after a failure. */
	back() {
		this.#expectPhase('initializing');
		const step = this.#initializer?.step;
		if (step === 'question' && this.#initializer?.question) {
			this.answer(this.#initializer.question.id, false);
			return;
		}
		if (step !== 'failed') {
			throw new StartupStateError('The folder is still loading.');
		}
		this.#generation++;
		this.#toSelecting();
	}

	/** Loads the same folder again after a failure, for instance once the broken files were fixed by hand. */
	retry() {
		const root = this.#failedRoot();
		this.#load(root);
	}

	/** Deletes the options files that failed validation, then loads the folder again (DESIGN.md §9.19). */
	async deleteAndRetry() {
		const root = this.#failedRoot();
		if (!this.#initializer?.canDelete) {
			throw new StartupStateError('These files can’t be deleted from here.');
		}
		const files = this.#errors.map((error) => /** @type {string} */ (error.filePath));
		this.#update({ step: 'scanning' });
		try {
			for (const file of files) {
				await this.#deleteFile(file);
			}
		} catch (error) {
			this.#update({ step: 'failed', error: `Could not delete a file: ${error instanceof Error ? error.message : String(error)}` });
			return;
		}
		this.#load(root);
	}

	/**
	 * Closes the soundboard and goes back to choosing a folder.
	 * @throws {StartupStateError} unless a soundboard is open
	 */
	async close() {
		this.#expectPhase('ready');
		const board = this.#board;
		this.#board = null;
		this.#toSelecting();
		await board?.close();
	}

	/** Closes whatever is open, for the app's shutdown. Safe to call in any phase, and twice. */
	async shutdown() {
		this.#generation++;
		this.#answer?.(false);
		this.#answer = null;
		const board = this.#board;
		this.#board = null;
		await board?.close();
	}

	/** @param {string} root */
	#load(root) {
		const generation = ++this.#generation;
		this.#phase = 'initializing';
		this.#errors = [];
		this.#details = null;
		this.#initializer = { root, step: 'scanning', question: null, progress: null, failures: [], error: null, canDelete: false };
		this.#run(root, generation).catch((error) => {
			if (generation !== this.#generation) {
				return;
			}
			this.#logError(error);
			this.#update({ step: 'failed', error: error instanceof Error ? error.message : String(error), canDelete: false });
		});
	}

	/**
	 * @param {string} root
	 * @param {number} generation
	 */
	async #run(root, generation) {
		const current = () => generation === this.#generation;
		const outcome = await this.#open(root, { prompter: this.#prompterFor(current), reporter: this.#reporterFor(current) });
		if (!current()) {
			if (outcome.status === 'ready') {
				// Nobody waits for it any more; it is started and closed so nothing stays half open.
				await outcome.start().then((board) => board.close(), () => {});
			}
			return;
		}
		if (outcome.status === 'cancelled') {
			this.#toSelecting();
			return;
		}
		if (outcome.status === 'invalid') {
			this.#errors = outcome.errors;
			this.#update({
				step: 'failed',
				failures: outcome.errors.map((error) => ({
					path: error.filePath === null ? '' : relative(root, error.filePath),
					problems: error.problems,
				})),
				canDelete: outcome.errors.every((error) => error.filePath !== null && isDeletable(root, error.filePath)),
			});
			return;
		}
		if (!this.#toolsDone) {
			this.#update({ step: 'waitingForTools', progress: null });
			await this.#toolsReady.catch(() => {});
		}
		if (!current()) {
			return;
		}
		this.#update({ step: 'starting', progress: null });
		const board = await outcome.start();
		if (!current()) {
			await board.close();
			return;
		}
		this.#board = board;
		this.#phase = 'ready';
		this.#initializer = null;
		await this.#recent.add(root).catch((error) => this.#logError(error));
	}

	/**
	 * @param {() => boolean} current
	 * @returns {Prompter}
	 */
	#prompterFor(current) {
		return {
			confirm: (text) => {
				if (!current()) {
					return Promise.resolve(false);
				}
				const kind = QUESTION_KINDS[text];
				const details = this.#details;
				if (!kind || details?.kind !== kind) {
					throw new Error(`No details were reported for the question: ${text}`);
				}
				const question = /** @type {Question} */ ({ id: ++this.#questionIds, ...details });
				this.#details = null;
				this.#update({ step: 'question', question });
				return new Promise((resolveAnswer) => {
					this.#answer = resolveAnswer;
				});
			},
		};
	}

	/**
	 * Only what the user has to decide on, and the progress, reaches the page; the rest becomes problems in the board
	 * (DESIGN.md §5.1) or is left out.
	 * @param {() => boolean} current
	 * @returns {Reporter}
	 */
	#reporterFor(current) {
		const ignore = () => {};
		return {
			validationErrors: ignore,
			warnings: ignore,
			optionsGenerated: ignore,
			libraryLoaded: ignore,
			largeFolder: (count) => {
				this.#details = { kind: 'largeFolder', count };
			},
			nestedDirectories: (paths) => {
				this.#details = { kind: 'nestedDirectories', paths };
			},
			metadataTitles: (titles) => {
				this.#details = { kind: 'metadataTitles', titles };
			},
			measuringDurations: (total) => {
				if (current()) {
					this.#update({ step: 'measuring', progress: { done: 0, total } });
				}
			},
			measured: (done, total) => {
				if (current()) {
					this.#update({ step: 'measuring', progress: { done, total } });
				}
			},
		};
	}

	/** @param {Partial<InitializerState>} changes */
	#update(changes) {
		if (this.#initializer) {
			this.#initializer = { ...this.#initializer, ...changes };
		}
	}

	#toSelecting() {
		this.#phase = 'selecting';
		this.#initializer = null;
		this.#errors = [];
	}

	/** @returns {string} */
	#failedRoot() {
		this.#expectPhase('initializing');
		if (this.#initializer?.step !== 'failed') {
			throw new StartupStateError('The folder is still loading.');
		}
		return this.#initializer.root;
	}

	/** @param {Phase} phase */
	#expectPhase(phase) {
		if (this.#phase !== phase) {
			throw new StartupStateError(`Not possible while the soundboard is ${PHASE_NAMES[this.#phase]}.`);
		}
	}
}

/** @type {Record<Phase, string>} */
const PHASE_NAMES = { selecting: 'being chosen', initializing: 'loading', ready: 'open' };

/**
 * Only the app's own files, inside the folder, may be deleted from the page: options files and `.soundboard`.
 * @param {string} root
 * @param {string} file
 */
function isDeletable(root, file) {
	const inside = relative(root, file);
	return !inside.startsWith('..') && !isAbsolute(inside) && (file.endsWith('.json') || basename(file) === '.soundboard');
}
