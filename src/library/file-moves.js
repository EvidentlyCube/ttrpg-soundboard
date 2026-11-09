import { lstat, mkdir, readdir, rename, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { uniqueName } from '../downloads/file-names.js';
import { backgroundOwnerOf, findBackgroundFiles } from './backgrounds.js';
import { audioFormatOf } from './classify.js';

/** Where deleted files go, mirroring their place in the root (DESIGN.md §2.5). Its dot hides it from the scanner. */
export const TRASH_DIRECTORY = '.trash';

/**
 * The files that belong to an audio file and travel with it: its options file and its waveform (DESIGN.md §2.5). Its
 * image, `<name>.bg.<extension>`, travels too, found by `findBackgroundFiles`.
 */
const COMPANION_SUFFIXES = ['.json', '.wf'];

/**
 * Moves an audio file and its companions into a directory, keeping the name unless it, or a companion's name, is
 * taken there; then ` (2)` and so on is added before the extension, so the companions stay paired.
 * @param {string} from the audio file
 * @param {string} toDirectory created if missing
 * @returns {Promise<{ path: string, renamed: [string, string][] }>} the audio file's new path, and every file moved
 */
export async function moveAudioFile(from, toDirectory) {
	await mkdir(toDirectory, { recursive: true });
	const name = await uniqueName(basename(from), (candidate) => isAnyTaken(toDirectory, candidate));
	const path = join(toDirectory, name);
	// Images keep their own extension, so they are found by name rather than by a fixed suffix.
	const images = (await findBackgroundFiles(dirname(from), basename(from))).map((image) => image.slice(from.length));
	/** @type {[string, string][]} */
	const renamed = [];
	for (const suffix of ['', ...COMPANION_SUFFIXES, ...images]) {
		if (suffix === '' || await exists(`${from}${suffix}`)) {
			await rename(`${from}${suffix}`, `${path}${suffix}`);
			renamed.push([`${from}${suffix}`, `${path}${suffix}`]);
		}
	}
	return { path, renamed };
}

/**
 * Moves a directory into another one under the same name, merging it into a directory already there. Audio files that
 * clash are renamed as `moveAudioFile` does, other files that clash get ` (2)` on their own, and the emptied source
 * directories are removed.
 * @param {string} from
 * @param {string} toParent created if missing
 */
export async function mergeDirectory(from, toParent) {
	await mkdir(toParent, { recursive: true });
	const to = join(toParent, basename(from));
	if (!(await exists(to))) {
		await rename(from, to);
		return;
	}
	const entries = await readdir(from, { withFileTypes: true });
	const names = new Set(entries.map((entry) => entry.name));
	// Companions are moved with their audio file, so they are skipped on their own.
	const isAudio = (/** @type {string | null} */ name) => name !== null && names.has(name) && audioFormatOf(name) !== null;
	const isCompanion = (/** @type {string} */ name) => isAudio(backgroundOwnerOf(name)) || COMPANION_SUFFIXES.some((suffix) => (
		name.endsWith(suffix)
		&& isAudio(name.slice(0, -suffix.length))
	));
	for (const entry of entries) {
		const path = join(from, entry.name);
		if (entry.isDirectory()) {
			await mergeDirectory(path, to);
		} else if (audioFormatOf(entry.name) !== null) {
			await moveAudioFile(path, to);
		} else if (!isCompanion(entry.name)) {
			const name = await uniqueName(entry.name, (candidate) => exists(join(to, candidate)));
			await rename(path, join(to, name));
		}
	}
	await rmdir(from);
}

/**
 * The directory inside the trash that mirrors where a root-relative id lives.
 * @param {string} root
 * @param {string} id root-relative, using `/`
 */
export function trashDirectoryFor(root, id) {
	return dirname(join(root, TRASH_DIRECTORY, ...id.split('/')));
}

/**
 * @param {string} directory
 * @param {string} name
 */
async function isAnyTaken(directory, name) {
	for (const suffix of ['', ...COMPANION_SUFFIXES]) {
		if (await exists(join(directory, `${name}${suffix}`))) {
			return true;
		}
	}
	return (await findBackgroundFiles(directory, name)).length > 0;
}

/** @param {string} path */
export async function exists(path) {
	return lstat(path).then(() => true, () => false);
}
