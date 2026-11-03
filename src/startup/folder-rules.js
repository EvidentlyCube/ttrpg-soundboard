import { readdir, stat } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { audioFormatOf } from '../library/classify.js';

/**
 * Where the app runs, passed in so every platform's rules can be tested anywhere.
 * @typedef {object} Platform
 * @property {NodeJS.Platform} name
 * @property {string} home the user's home folder
 * @property {string} [systemDrive] Windows only: the drive Windows is installed on, such as `C:`
 */

/** @typedef {{ allowed: true, reason: null } | { allowed: false, reason: string }} FolderCheck */

export const SYSTEM_REASON = 'System folders can’t be used.';
export const CONTAINER_REASON = 'Choose a folder inside this one.';
export const MISSING_REASON = 'This folder doesn’t exist.';
export const NOT_FOLDER_REASON = 'This is not a folder.';
export const UNREADABLE_REASON = 'This folder can’t be read.';
export const NO_AUDIO_REASON = 'No audio files found here.';

/** Refused with everything inside them (DESIGN.md §5.7). */
const POSIX_SYSTEM = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/opt', '/proc', '/root', '/run', '/sbin', '/snap', '/srv', '/sys', '/usr', '/var'];
const MAC_SYSTEM = ['/System', '/Library', '/Applications', '/private', '/cores'];
/** Fedora and others mount removable drives here, inside the otherwise refused `/run`. */
const POSIX_MOUNTS = '/run/media';
/** Refused only as themselves: they hold other places, never sounds. */
const POSIX_CONTAINERS = ['/', '/home', '/Users', '/Volumes', '/media', '/mnt', POSIX_MOUNTS];
const WINDOWS_SYSTEM = ['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', '$Recycle.Bin', 'System Volume Information'];

/**
 * Why a folder may never be a soundboard, from its path alone: system folders and the folders that only hold other
 * places. Paths are compared without regard to case on Windows and macOS, whose disks usually ignore it.
 * @param {string} path absolute
 * @param {Platform} platform
 * @returns {string | null} the reason, or null when the path itself is fine
 */
export function refusalOf(path, platform) {
	const windows = platform.name === 'win32';
	const paths = windows ? win32 : posix;
	const fold = (/** @type {string} */ text) => (windows || platform.name === 'darwin' ? text.toLowerCase() : text);
	const target = fold(paths.resolve(path));
	const same = (/** @type {string} */ other) => target === fold(paths.resolve(other));
	const inside = (/** @type {string} */ other) => {
		const relative = paths.relative(fold(paths.resolve(other)), target);
		return relative === '' || (!relative.startsWith('..') && !paths.isAbsolute(relative));
	};

	if (same(platform.home)) {
		return CONTAINER_REASON;
	}
	if (windows) {
		const { root } = win32.parse(target);
		const drive = root.slice(0, 2);
		if (inside(win32.join(platform.home, 'AppData')) || WINDOWS_SYSTEM.some((name) => inside(`${drive}\\${name}`))) {
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
 * Whether a folder may be opened as a soundboard (DESIGN.md §5.7): it exists, its path isn't refused, and it already is a
 * soundboard or holds audio files within two levels.
 * @param {string} path absolute
 * @param {Platform} platform
 * @returns {Promise<FolderCheck>}
 */
export async function checkFolder(path, platform) {
	const stats = await stat(path).catch(() => null);
	if (!stats) {
		return refused(MISSING_REASON);
	}
	if (!stats.isDirectory()) {
		return refused(NOT_FOLDER_REASON);
	}
	const reason = refusalOf(path, platform);
	if (reason !== null) {
		return refused(reason);
	}
	const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
	if (!entries) {
		return refused(UNREADABLE_REASON);
	}
	if (entries.some((entry) => entry.name === '.soundboard') || entries.some((entry) => entry.isFile() && audioFormatOf(entry.name))) {
		return { allowed: true, reason: null };
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) {
			continue;
		}
		const names = await readdir(join(path, entry.name)).catch(() => []);
		if (names.some((name) => audioFormatOf(name))) {
			return { allowed: true, reason: null };
		}
	}
	return refused(NO_AUDIO_REASON);
}

/**
 * @param {string} reason
 * @returns {FolderCheck}
 */
function refused(reason) {
	return { allowed: false, reason };
}
