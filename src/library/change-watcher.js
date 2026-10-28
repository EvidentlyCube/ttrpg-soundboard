import { watch as fsWatch } from 'node:fs';
import { updateJsonFile } from './options-store.js';
import { differs, matchesScan, stampFile, takeBaseline, takeSnapshot } from './tree-snapshot.js';

/** @typedef {import('./scanner.js').ScanResult} ScanResult */
/** @typedef {import('./settings-store.js').FileUpdater} FileUpdater */
/** @typedef {import('./tree-snapshot.js').Baseline} Baseline */

/**
 * @typedef {object} DirectoryWatcher
 * @property {(event: 'error', listener: (error: Error) => void) => unknown} on
 * @property {() => void} close
 */

/** @typedef {(root: string, options: { recursive: true }, listener: () => void) => DirectoryWatcher} WatchFunction */

/**
 * @typedef {object} Timers the backend's clock port, so tests can run the delays on a fake clock
 * @property {(callback: () => void, milliseconds: number) => unknown} setTimeout
 * @property {(id: any) => void} clearTimeout
 * @property {(callback: () => void, milliseconds: number) => unknown} setInterval
 * @property {(id: any) => void} clearInterval
 */

/** @type {Timers} */
const NODE_TIMERS = { setTimeout, clearTimeout, setInterval, clearInterval };

/** How long the directory must stay quiet after an event before it is compared, so a copy in progress is checked once. */
export const QUIET_MS = 1000;
/** How often the directory is checked when it can't be watched. */
export const POLL_MS = 30_000;

/**
 * Notices files added, removed or changed outside the app (DESIGN.md §5.3). It keeps a baseline of
 * the files the app read, and compares the directory with it after file system events, when asked, and every 30 s if
 * watching is impossible. Once a change is found it says so and stops checking until the next refresh.
 *
 * Comparisons, the app's own writes and refreshes take turns, so a file the app is writing is never mistaken for an
 * external change and a refresh never misses a save.
 */
export class ChangeWatcher {
	#root;
	#watch;
	#timers;
	#log;
	/** @type {Baseline} */
	#baseline = new Map();
	#changed = false;
	/** @type {Set<(changed: boolean) => void>} */
	#listeners = new Set();
	/** @type {Promise<unknown>} */
	#queue = Promise.resolve();
	/** @type {DirectoryWatcher | null} */
	#watcher = null;
	/** @type {unknown} */
	#quietTimer = null;
	/** @type {unknown} */
	#pollTimer = null;

	/**
	 * @param {object} options
	 * @param {string} options.root
	 * @param {(message: string) => void} options.log for the terminal: watching fell back to polling, a check failed
	 * @param {WatchFunction} [options.watch]
	 * @param {Timers} [options.timers]
	 */
	constructor({ root, log, watch = fsWatch, timers = NODE_TIMERS }) {
		this.#root = root;
		this.#log = log;
		this.#watch = watch;
		this.#timers = timers;
	}

	/** Whether files changed outside the app since the last start or refresh. */
	get externalChanges() {
		return this.#changed;
	}

	/**
	 * Saves a JSON file like `updateJsonFile`, recording the result so it doesn't count as an external change. Give it to
	 * `LibraryEditor` and `SettingsStore`.
	 * @type {FileUpdater}
	 */
	updateFile = (path, update) => this.#exclusive(async () => {
		await updateJsonFile(path, update);
		try {
			this.#baseline.set(path, await stampFile(path));
		} catch {
			// Changed again before it could be read; the next comparison sees whatever it is now.
		}
	});

	/**
	 * @param {(changed: boolean) => void} listener called whenever `externalChanges` changes
	 * @returns {() => void} unsubscribes
	 */
	onChange(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Takes the baseline and starts watching. Call it once bootstrap has finished writing.
	 * @param {ScanResult} scan what bootstrap built the library from
	 */
	async start(scan) {
		await this.#exclusive(() => this.#rebaseline(scan));
		try {
			const watcher = this.#watch(this.#root, { recursive: true }, () => this.#onEvent());
			watcher.on('error', (error) => this.#fallBackToPolling(error));
			this.#watcher = watcher;
		} catch (error) {
			this.#fallBackToPolling(error);
		}
	}

	stop() {
		this.#watcher?.close();
		this.#watcher = null;
		this.#timers.clearTimeout(this.#quietTimer);
		this.#timers.clearInterval(this.#pollTimer);
	}

	/**
	 * A quick check by size and modified time only, for when the page comes back into focus.
	 * @returns {Promise<boolean>} `externalChanges` afterwards
	 */
	check() {
		return this.#exclusive(async () => {
			await this.#compare({ hash: false });
			return this.#changed;
		});
	}

	/**
	 * Runs a rebuild of the library with nothing else in between, and takes a new baseline if it succeeded.
	 * @template {{ status: string, scan?: ScanResult }} T
	 * @param {() => Promise<T>} rebuild
	 * @returns {Promise<T>}
	 */
	refresh(rebuild) {
		return this.#exclusive(async () => {
			const outcome = await rebuild();
			if (outcome.scan) {
				await this.#rebaseline(outcome.scan);
			}
			return outcome;
		});
	}

	/** @param {ScanResult} scan */
	async #rebaseline(scan) {
		this.#baseline = await takeBaseline(this.#root);
		this.#setChanged(!matchesScan(this.#baseline, scan));
	}

	#onEvent() {
		if (this.#changed) {
			return;
		}
		this.#timers.clearTimeout(this.#quietTimer);
		this.#quietTimer = this.#timers.setTimeout(() => {
			this.#quietTimer = null;
			this.#exclusive(() => this.#compare({ hash: true }));
		}, QUIET_MS);
	}

	/** @param {unknown} error */
	#fallBackToPolling(error) {
		this.#watcher?.close();
		this.#watcher = null;
		if (this.#pollTimer !== null) {
			return;
		}
		this.#log(`Can't watch the audio directory (${error instanceof Error ? error.message : String(error)}); checking it every 30 seconds instead.`);
		this.#pollTimer = this.#timers.setInterval(() => {
			this.#exclusive(() => this.#compare({ hash: false }));
		}, POLL_MS);
	}

	/** @param {{ hash: boolean }} options */
	async #compare(options) {
		if (this.#changed) {
			return;
		}
		try {
			this.#setChanged(await differs(this.#baseline, await takeSnapshot(this.#root), options));
		} catch (error) {
			// The directory itself may be gone or unreadable; a refresh will say what is wrong.
			this.#log(`Checking the audio directory failed: ${error instanceof Error ? error.message : String(error)}`);
			this.#setChanged(true);
		}
	}

	/** @param {boolean} changed */
	#setChanged(changed) {
		if (changed === this.#changed) {
			return;
		}
		this.#changed = changed;
		for (const listener of this.#listeners) {
			listener(changed);
		}
	}

	/**
	 * Runs the task after every task queued before it.
	 * @template T
	 * @param {() => Promise<T>} task
	 * @returns {Promise<T>}
	 */
	#exclusive(task) {
		const run = this.#queue.then(task);
		this.#queue = run.catch(() => {});
		return run;
	}
}
