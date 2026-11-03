import { readdir, realpath, stat } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { audioFormatOf } from '../library/classify.js';

/**
 * Where the app runs and what it may open, passed in so every platform's rules can be tested anywhere.
 * @typedef {object} Platform
 * @property {NodeJS.Platform} name
 * @property {string} home the user's home folder, with symbolic links resolved
 * @property {string} [systemDrive] Windows only: the drive Windows is installed on, such as `C:`
 * @property {string[]} roots the only folders that may be browsed and opened, and what is inside them; resolved like `home`
 * @property {boolean} allowHidden whether folders starting with a dot may be browsed and opened (`--allow-hidden`)
 */

/** @typedef {{ allowed: true, reason: null, path: string } | { allowed: false, reason: string, path: string }} FolderCheck */

export const OUTSIDE_REASON = 'This folder is outside the folders the app may open.';
export const HIDDEN_REASON = 'Hidden folders can’t be used.';
export const SYSTEM_REASON = 'System folders can’t be used.';
export const CONTAINER_REASON = 'Choose a folder inside this one.';
export const MISSING_REASON = 'This folder doesn’t exist.';
export const NOT_FOLDER_REASON = 'This is not a folder.';
export const UNREADABLE_REASON = 'This folder can’t be read.';
export const NO_AUDIO_REASON = 'No audio files found here.';
export const HOLDS_SOUNDBOARD_REASON = 'A folder inside this one is already a soundboard.';

/** Refused with everything inside them (DESIGN.md §5.7). */
const POSIX_SYSTEM = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/opt', '/proc', '/root', '/run', '/sbin', '/snap', '/srv', '/sys', '/usr', '/var'];
const MAC_SYSTEM = ['/System', '/Library', '/Applications', '/private', '/cores'];
/** Fedora and others mount removable drives here, inside the otherwise refused `/run`. */
const POSIX_MOUNTS = '/run/media';
/** Refused only as themselves: they hold other places, never sounds. */
const POSIX_CONTAINERS = ['/', '/home', '/Users', '/Volumes', '/media', '/mnt', POSIX_MOUNTS];
const WINDOWS_SYSTEM = ['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', '$Recycle.Bin', 'System Volume Information'];

/**
 * Why a folder may not even be browsed (DESIGN.md §5.7): it is outside every allowed root, or hidden below its root.
 * @param {string} path absolute, with symbolic links resolved
 * @param {Platform} platform
 * @returns {string | null} the reason, or null when it may be browsed
 */
export function browseRefusalOf(path, platform) {
	const { paths, fold, target, inside } = compare(path, platform);
	const root = platform.roots.find(inside);
	if (root === undefined) {
		return OUTSIDE_REASON;
	}
	// The root itself may be hidden: it was named on purpose.
	const below = paths.relative(fold(paths.resolve(root)), target);
	if (!platform.allowHidden && below !== '' && below.split(paths.sep).some((part) => part.startsWith('.'))) {
		return HIDDEN_REASON;
	}
	return null;
}

/**
 * Why a folder may never be a soundboard, from its path alone: outside the roots or hidden (`browseRefusalOf`), a
 * system folder, or a folder that only holds other places. Paths are compared without regard to case on Windows and
 * macOS, whose disks usually ignore it.
 * @param {string} path absolute, with symbolic links resolved
 * @param {Platform} platform
 * @returns {string | null} the reason, or null when the path itself is fine
 */
export function refusalOf(path, platform) {
	const browsing = browseRefusalOf(path, platform);
	if (browsing !== null) {
		return browsing;
	}
	const { target, fold, same, inside } = compare(path, platform);
	if (same(platform.home)) {
		return CONTAINER_REASON;
	}
	if (platform.name === 'win32' && inside(win32.join(platform.home, 'AppData'))) {
		return SYSTEM_REASON;
	}
	// Some systems keep home folders inside a system folder, such as `/var/home` on Fedora Silverblue.
	if (inside(platform.home)) {
		return null;
	}
	if (platform.name === 'win32') {
		const { root } = win32.parse(target);
		const drive = root.slice(0, 2);
		if (WINDOWS_SYSTEM.some((name) => inside(`${drive}\\${name}`))) {
			return SYSTEM_REASON;
		}
		if (same(`${drive}\\Users`) || (target === fold(root) && drive.toLowerCase() === (platform.systemDrive ?? 'C:').toLowerCase())) {
			return CONTAINER_REASON;
		}
		return null;
	}
	if (POSIX_CONTAINERS.some(same)) {
		return CONTAINER_REASON;
	}
	const system = platform.name === 'darwin' ? [...POSIX_SYSTEM, ...MAC_SYSTEM] : POSIX_SYSTEM;
	if (!inside(POSIX_MOUNTS) && system.some(inside)) {
		return SYSTEM_REASON;
	}
	return null;
}

/**
 * @param {string} path
 * @param {Platform} platform
 */
function compare(path, platform) {
	const paths = platform.name === 'win32' ? win32 : posix;
	const fold = (/** @type {string} */ text) => (platform.name === 'win32' || platform.name === 'darwin' ? text.toLowerCase() : text);
	const target = fold(paths.resolve(path));
	return {
		paths,
		fold,
		target,
		same: (/** @type {string} */ other) => target === fold(paths.resolve(other)),
		inside: (/** @type {string} */ other) => {
			const relative = paths.relative(fold(paths.resolve(other)), target);
			return relative === '' || (!relative.startsWith('..') && !paths.isAbsolute(relative));
		},
	};
}

/**
 * The path with symbolic links resolved, so a link can't lead out of the roots.
 * @param {string} path
 * @returns {Promise<string | null>} null when it doesn't exist
 */
export async function resolvedPath(path) {
	return realpath(path).catch(() => null);
}

/**
 * Whether a folder may be opened as a soundboard (DESIGN.md §5.7): it exists, its path isn't refused, and it already is a
 * soundboard or holds audio files within two levels. Symbolic links are resolved first.
 * @param {string} path absolute
 * @param {Platform} platform
 * @returns {Promise<FolderCheck>} `path` is the resolved path, the one to open
 */
export async function checkFolder(path, platform) {
	const real = await resolvedPath(path);
	/** @param {string} reason @returns {FolderCheck} */
	const refused = (reason) => ({ allowed: false, reason, path: real ?? path });
	if (real === null) {
		return refused(MISSING_REASON);
	}
	const stats = await stat(real).catch(() => null);
	if (!stats?.isDirectory()) {
		return refused(NOT_FOLDER_REASON);
	}
	const reason = refusalOf(real, platform);
	if (reason !== null) {
		return refused(reason);
	}
	const entries = await readdir(real, { withFileTypes: true }).catch(() => null);
	if (!entries) {
		return refused(UNREADABLE_REASON);
	}
	const allowed = /** @type {FolderCheck} */ ({ allowed: true, reason: null, path: real });
	if (entries.some((entry) => entry.name === '.soundboard')) {
		return allowed;
	}
	let audio = entries.some((entry) => entry.isFile() && audioFormatOf(entry.name));
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) {
			continue;
		}
		const names = await readdir(join(real, entry.name)).catch(() => /** @type {string[]} */ ([]));
		// A soundboard in a subfolder would become a playlist of this one, and both would write into the same files.
		if (names.includes('.soundboard')) {
			return refused(HOLDS_SOUNDBOARD_REASON);
		}
		audio ||= names.some((name) => audioFormatOf(name));
	}
	return audio ? allowed : refused(NO_AUDIO_REASON);
}
