import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { sha1File } from './durations.js';
import { scanAudioDirectory } from './scanner.js';
import { isPlainObject } from './validate.js';

/** @typedef {import('./scanner.js').ScanResult} ScanResult */
/** @typedef {{ size: number, modified: string }} FileStamp */
/** @typedef {FileStamp & { sha1: string | null }} BaselineEntry sha1 is null when it isn't known */
/** @typedef {Map<string, FileStamp>} Snapshot by absolute path */
/** @typedef {Map<string, BaselineEntry>} Baseline by absolute path */

/**
 * The size and modified time of every file the app reads (DESIGN.md §2.1): audio files, their options files, playlist
 * options files and `.soundboard`. Like the scanner, it reads directory listings and file dates only.
 * @param {string} root
 * @returns {Promise<Snapshot>}
 */
export async function takeSnapshot(root) {
	return snapshotOf(await scanAudioDirectory(root));
}

/**
 * Takes a snapshot and hashes its options files and `.soundboard`. Audio files are not read: they take the SHA-1 their
 * options file recorded when the duration was measured (DESIGN.md §3.5), if it still matches.
 * @param {string} root
 * @returns {Promise<Baseline>}
 */
export async function takeBaseline(root) {
	const snapshot = await takeSnapshot(root);
	/** @type {Map<string, Buffer>} */
	const contents = new Map();
	await Promise.all([...snapshot.keys()].filter(isSmallFile).map(async (path) => {
		const content = await readFile(path).catch(() => null);
		if (content !== null) {
			contents.set(path, content);
		}
	}));
	/** @type {Baseline} */
	const baseline = new Map();
	for (const [path, stamp] of snapshot) {
		const content = contents.get(path);
		const sha1 = content === undefined ? recordedSha1(stamp, contents.get(`${path}.json`)) : sha1Of(content);
		baseline.set(path, { ...stamp, sha1 });
	}
	return baseline;
}

/**
 * Whether the files on disk differ from the baseline. With `hash`, a file whose size or date changed is hashed and
 * only counts when its content differs; a file found unchanged gets its new date recorded so it isn't hashed again.
 * @param {Baseline} baseline
 * @param {Snapshot} snapshot
 * @param {{ hash: boolean }} options
 */
export async function differs(baseline, snapshot, { hash }) {
	if ([...baseline.keys()].some((path) => !snapshot.has(path))) {
		return true;
	}
	for (const [path, stamp] of snapshot) {
		const entry = baseline.get(path);
		if (!entry) {
			return true;
		}
		if (entry.size === stamp.size && entry.modified === stamp.modified) {
			continue;
		}
		if (!hash || entry.sha1 === null) {
			return true;
		}
		const sha1 = await sha1File(path).catch(() => null);
		if (sha1 !== entry.sha1) {
			return true;
		}
		baseline.set(path, { ...stamp, sha1 });
	}
	return false;
}

/**
 * Whether the audio files in the baseline are the ones a scan found, with the same sizes and dates. Used to notice
 * files that changed while bootstrap was busy with the scan's results.
 * @param {Baseline} baseline
 * @param {ScanResult} scan
 */
export function matchesScan(baseline, scan) {
	const scanned = [...scan.sounds, ...scan.playlists.flatMap((playlist) => playlist.tracks)];
	const audioInBaseline = [...baseline.keys()].filter((path) => !isSmallFile(path));
	return audioInBaseline.length === scanned.length && scanned.every((audio) => {
		const entry = baseline.get(audio.absolutePath);
		return entry !== undefined && entry.size === audio.size && entry.modified === audio.modified;
	});
}

/**
 * @param {string} path
 * @returns {Promise<BaselineEntry>}
 */
export async function stampFile(path) {
	const [{ size, mtime }, sha1] = await Promise.all([stat(path), sha1File(path)]);
	return { size, modified: mtime.toISOString(), sha1 };
}

/**
 * @param {ScanResult} scan
 * @returns {Promise<Snapshot>}
 */
async function snapshotOf(scan) {
	/** @type {Snapshot} */
	const snapshot = new Map();
	/** @type {string[]} */
	const others = scan.hasSettingsFile ? [scan.settingsPath] : [];
	for (const audio of [...scan.sounds, ...scan.playlists.flatMap((playlist) => playlist.tracks)]) {
		snapshot.set(audio.absolutePath, { size: audio.size, modified: audio.modified });
		if (audio.hasOptions) {
			others.push(audio.optionsPath);
		}
	}
	others.push(...scan.playlists.filter((playlist) => playlist.hasOptions).map((playlist) => playlist.optionsPath));
	const stamps = await Promise.all(others.map((path) => stat(path).catch(() => null)));
	others.forEach((path, index) => {
		const stats = stamps[index];
		// A file deleted since the listing is simply not there.
		if (stats) {
			snapshot.set(path, { size: stats.size, modified: stats.mtime.toISOString() });
		}
	});
	return snapshot;
}

/** @param {string} path */
function isSmallFile(path) {
	return path.endsWith('.json') || path.endsWith('.soundboard');
}

/**
 * @param {FileStamp} stamp
 * @param {Buffer | undefined} optionsFile
 */
function recordedSha1(stamp, optionsFile) {
	let options;
	try {
		options = optionsFile === undefined ? null : JSON.parse(optionsFile.toString('utf8'));
	} catch {
		return null;
	}
	const from = isPlainObject(options) ? options.measuredFrom : null;
	return isPlainObject(from) && from.size === stamp.size && from.modified === stamp.modified && typeof from.sha1 === 'string'
		? from.sha1
		: null;
}

/** @param {Buffer} content */
function sha1Of(content) {
	return createHash('sha1').update(content).digest('hex');
}
