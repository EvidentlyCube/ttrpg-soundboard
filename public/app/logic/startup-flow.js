import { codedTextOf } from './errors.js';

/** @typedef {import('./ports.js').Clock} Clock */
/** @typedef {import('./errors.js').CodedText} CodedText */

/** How often the startup pages ask the server where things stand. */
export const STARTUP_POLL_MS = 500;

/**
 * @typedef {{ id: number, kind: 'largeFolder', count: number }
 * 	| { id: number, kind: 'nestedDirectories', paths: string[] }
 * 	| { id: number, kind: 'metadataTitles', titles: { path: string, title: string }[] }} StartupQuestion
 */

/**
 * @typedef {object} InitializerState what loading the chosen folder has come to (DESIGN.md §9.19)
 * @property {string} root
 * @property {'scanning' | 'question' | 'measuring' | 'waitingForTools' | 'starting' | 'failed'} step
 * @property {StartupQuestion | null} question
 * @property {{ done: number, total: number } | null} progress
 * @property {{ path: string, problems: string[] }[]} failures
 * @property {string | null} error
 * @property {string | null} [errorCode] what the page translates `error` by (DESIGN.md §9.21)
 * @property {Readonly<Record<string, string | number>> | null} [errorParams]
 * @property {boolean} canDelete
 */

/**
 * @typedef {object} StartupState `GET /api/startup` (DESIGN.md §5.2)
 * @property {'selecting' | 'initializing' | 'ready'} phase
 * @property {{ path: string, name: string, allowed: boolean, reason: string | null, reasonCode?: string | null }[] | null} paths
 * @property {{ path: string, name: string, exists: boolean }[]} recent
 * @property {InitializerState | null} initializer
 * @property {import('./ports.js').AppInfo & { checking: boolean }} tools
 */

/** @typedef {{ name: string, path: string }} Place */

/**
 * @typedef {object} FolderListing
 * @property {string} path
 * @property {string | null} parent
 * @property {{ name: string, title: string | null, path: string, soundboard: boolean, holdsSoundboard: boolean, refused: string | null,
 * 	refusedCode?: string | null }[]} folders `title`: a soundboard's own name; `holdsSoundboard`: a soundboard was found up to
 * 	three levels inside
 * @property {number} audioFiles
 * @property {string[]} files the audio files' names
 * @property {boolean} soundboard
 * @property {boolean} allowed
 * @property {string | null} reason
 * @property {string | null} [reasonCode]
 */

/**
 * The startup routes, as the Selector and the Initializer use them. Every action rejects with the server's message.
 * @typedef {object} StartupApi
 * @property {() => Promise<StartupState>} fetchState
 * @property {() => Promise<{ places: Place[], browsed: string | null }>} fetchPlaces with the folder the browser showed last
 * @property {(path: string) => Promise<FolderListing>} listFolder
 * @property {(path: string) => Promise<void>} select
 * @property {(id: number, yes: boolean) => Promise<void>} answer
 * @property {() => Promise<void>} back
 * @property {() => Promise<void>} retry
 * @property {() => Promise<void>} deleteAndRetry
 * @property {(path: string) => Promise<void>} forgetRecent
 * @property {(language: string | null) => Promise<void>} setLanguage null: the browser's (DESIGN.md §9.21)
 */

/**
 * @typedef {object} StartupView everything the startup pages draw
 * @property {StartupState | null} state null until the first answer
 * @property {boolean} connected false while the server doesn't answer
 * @property {Place[]} places
 * @property {FolderListing | null} listing the folder being browsed
 * @property {CodedText | null} error the last action's failure, until the next action
 * @property {CodedText | null} browseError why the last folder asked for could not be shown
 * @property {number} browseFailures counts the folders that could not be shown, so the page can tell about each one and
 * 	put the path it shows back, even when the same refused path is typed twice
 * @property {boolean} busy while an action runs
 */

/**
 * The startup pages' side of the server's phases (DESIGN.md §3): polls `GET /api/startup`, browses folders and sends
 * the user's choices. A page belongs to one phase; once the server is in another, `onLeave` is called so the page can
 * load `/`, which the server answers with the page of the new phase.
 */
export class StartupFlow {
	#api;
	#clock;
	#phase;
	#onChange;
	#onLeave;
	/** @type {StartupView} */
	#view = { state: null, connected: true, places: [], listing: null, error: null, browseError: null, browseFailures: 0, busy: false };
	/** @type {number | null} */
	#timer = null;
	/** Answers to polls that started before an action are older than the action's result, so they are dropped. */
	#pollGeneration = 0;
	#browseGeneration = 0;
	#left = false;

	/**
	 * @param {object} options
	 * @param {StartupApi} options.api
	 * @param {Clock} options.clock
	 * @param {'selecting' | 'initializing'} options.phase the phase this page shows
	 * @param {(view: StartupView) => void} options.onChange
	 * @param {() => void} options.onLeave
	 */
	constructor({ api, clock, phase, onChange, onLeave }) {
		this.#api = api;
		this.#clock = clock;
		this.#phase = phase;
		this.#onChange = onChange;
		this.#onLeave = onLeave;
	}

	/** @returns {StartupView} */
	get view() {
		return this.#view;
	}

	start() {
		this.#poll();
		this.#timer ??= this.#clock.setInterval(() => this.#poll(), STARTUP_POLL_MS);
	}

	stop() {
		if (this.#timer !== null) {
			this.#clock.clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	/**
	 * Loads the starting places, then the folder shown last time, or the first place when there is none or it can no
	 * longer be shown. That folder failing tells nothing, since it was not asked for now. A folder asked for meanwhile,
	 * such as a path typed in, wins over both.
	 */
	async browseStart() {
		/** The last browse this method asked for; any other means the user asked for a folder. */
		let own = this.#browseGeneration;
		const untouched = () => this.#browseGeneration === own && this.#view.listing === null;
		try {
			const { places, browsed } = await this.#api.fetchPlaces();
			this.#set({ places });
			if (browsed !== null && untouched()) {
				own = ++this.#browseGeneration;
				const listing = await this.#api.listFolder(browsed).catch(() => null);
				if (listing && own === this.#browseGeneration) {
					this.#set({ listing });
				}
			}
			if (places.length > 0 && untouched()) {
				await this.browse(places[0].path);
			}
		} catch (error) {
			this.#set({ error: codedTextOf(error) });
		}
	}

	/**
	 * Shows a folder. One that can't be shown, such as a folder outside the allowed ones, leaves the current folder in
	 * place and sets `browseError` (DESIGN.md §9.18).
	 * @param {string} path
	 */
	async browse(path) {
		const generation = ++this.#browseGeneration;
		try {
			const listing = await this.#api.listFolder(path);
			if (generation === this.#browseGeneration) {
				this.#set({ listing });
			}
		} catch (error) {
			if (generation === this.#browseGeneration) {
				this.#set({ browseError: codedTextOf(error), browseFailures: this.#view.browseFailures + 1 });
			}
		}
	}

	/** @param {string} path */
	select(path) {
		return this.#act(() => this.#api.select(path));
	}

	/**
	 * @param {number} id
	 * @param {boolean} yes
	 */
	answer(id, yes) {
		return this.#act(() => this.#api.answer(id, yes));
	}

	back() {
		return this.#act(() => this.#api.back());
	}

	retry() {
		return this.#act(() => this.#api.retry());
	}

	deleteAndRetry() {
		return this.#act(() => this.#api.deleteAndRetry());
	}

	/** @param {string} path */
	forgetRecent(path) {
		return this.#act(() => this.#api.forgetRecent(path));
	}

	/**
	 * Saves the app's language; the page then loads again in it.
	 * @param {string | null} language
	 * @returns {Promise<boolean>} whether it was saved
	 */
	async setLanguage(language) {
		await this.#act(() => this.#api.setLanguage(language));
		return this.#view.error === null;
	}

	/** @param {() => Promise<void>} action */
	async #act(action) {
		if (this.#view.busy) {
			return;
		}
		this.#set({ busy: true, error: null });
		try {
			await action();
		} catch (error) {
			this.#set({ error: codedTextOf(error) });
		}
		this.#set({ busy: false });
		await this.#poll();
	}

	async #poll() {
		const generation = ++this.#pollGeneration;
		try {
			const state = await this.#api.fetchState();
			if (generation !== this.#pollGeneration || this.#left) {
				return;
			}
			if (state.phase !== this.#phase) {
				this.#left = true;
				this.stop();
				this.#onLeave();
				return;
			}
			this.#set({ state, connected: true });
		} catch {
			if (generation === this.#pollGeneration) {
				this.#set({ connected: false });
			}
		}
	}

	/** @param {Partial<StartupView>} changes */
	#set(changes) {
		this.#view = { ...this.#view, ...changes };
		this.#onChange(this.#view);
	}
}
