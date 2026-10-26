import { relative } from 'node:path';

/** @typedef {import('../library/bootstrap-service.js').Reporter} Reporter */
/** @typedef {import('../library/scanner.js').ScanWarning} ScanWarning */
/** @typedef {{ write: (chunk: string) => unknown }} Output */

const MAX_NESTED_DIRECTORIES_SHOWN = 10;

/** @type {Record<ScanWarning['kind'], string>} */
const WARNING_DESCRIPTIONS = {
	'unsupported-audio': 'Unsupported audio format, skipped',
	'orphan-options': 'Options file that belongs to nothing, ignored',
	'symlink': 'Symlink, ignored',
	'empty-playlist': 'Playlist without playable tracks, hidden',
};

/**
 * Prints bootstrap progress to the terminal.
 * @implements {Reporter}
 */
export class ConsoleReporter {
	#output;
	#colors;
	#root;

	/**
	 * @param {Output} output
	 * @param {import('./colors.js').Colors} colors
	 * @param {string} root paths are shown relative to this directory
	 */
	constructor(output, colors, root) {
		this.#output = output;
		this.#colors = colors;
		this.#root = root;
	}

	/** @type {Reporter['validationErrors']} */
	validationErrors(errors) {
		const { red } = this.#colors;
		this.#print(red(`Found ${count(errors.length, 'invalid file')}. Fix or delete them, then start again:`));
		for (const error of errors) {
			const path = error.filePath === null ? '' : `${relative(this.#root, error.filePath)}: `;
			for (const problem of error.problems) {
				this.#print(red(`  ${path}${problem}`));
			}
		}
	}

	/** @type {Reporter['warnings']} */
	warnings(warnings) {
		const { yellow } = this.#colors;
		this.#print(yellow('Warnings:'));
		for (const { kind, path } of warnings) {
			this.#print(yellow(`  ${WARNING_DESCRIPTIONS[kind]}: ${path}`));
		}
	}

	/** @type {Reporter['nestedDirectories']} */
	nestedDirectories(paths) {
		const { red, bold } = this.#colors;
		const noun = paths.length === 1 ? 'directory' : 'directories';
		this.#print(bold(`Found ${paths.length} nested ${noun} inside playlists:`));
		for (const path of paths.slice(0, MAX_NESTED_DIRECTORIES_SHOWN)) {
			this.#print(red(`  ${path}`));
		}
		if (paths.length > MAX_NESTED_DIRECTORIES_SHOWN) {
			this.#print(red(`  …and ${paths.length - MAX_NESTED_DIRECTORIES_SHOWN} more`));
		}
	}

	/** @type {Reporter['metadataTitles']} */
	metadataTitles(titles) {
		this.#print(this.#colors.bold(`Found titles in ${count(titles.length, 'file')}:`));
		for (const { path, title } of titles) {
			this.#print(`  ${path} → "${title}"`);
		}
	}

	/** @type {Reporter['optionsGenerated']} */
	optionsGenerated(created) {
		this.#print(`Created or updated ${count(created, 'options file')}.`);
	}

	/** @type {Reporter['measuringDurations']} */
	measuringDurations(files) {
		// Said before the work starts: the first run reads every file once, which can take a while.
		this.#print(`Measuring the duration of ${count(files, 'audio file')}…`);
	}

	/** @type {Reporter['libraryLoaded']} */
	libraryLoaded(library) {
		this.#print(`Loaded ${count(library.playlists.length, 'playlist')} and ${count(library.sounds.length, 'sound')}.`);
	}

	/** @param {string} line */
	#print(line) {
		this.#output.write(`${line}\n`);
	}
}

/**
 * @param {number} amount
 * @param {string} noun singular form; the plural adds "s"
 */
function count(amount, noun) {
	return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}
