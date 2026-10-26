import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readDuration } from '../metadata/index.js';

/** @typedef {import('./scanner.js').ScannedAudio} ScannedAudio */
/** @typedef {import('./validate.js').AudioOptions} AudioOptions */
/** @typedef {import('./validate.js').MeasuredFrom} MeasuredFrom */
/** @typedef {{ duration: number | null, measuredFrom: MeasuredFrom }} Measurement */

/**
 * @typedef {object} MeasureIo
 * @property {(path: string) => Promise<string>} hashFile hex SHA-1 of the whole file
 * @property {(path: string) => Promise<number | null>} readDuration
 */

/** @type {MeasureIo} */
const DEFAULT_IO = { hashFile: sha1File, readDuration };

/**
 * Whether the file looks unchanged since its duration was measured, judged by size and date alone, so nothing is read.
 * @param {ScannedAudio} audio
 * @param {AudioOptions | undefined} options
 */
export function isMeasured(audio, options) {
	const from = options?.measuredFrom;
	return options !== undefined
		&& 'duration' in options
		&& from !== undefined
		&& from.size === audio.size
		&& from.modified === audio.modified;
}

/**
 * Works out what to store about a file's duration (DESIGN.md §3.5). Nothing is read for a file whose size and date
 * match the record. Otherwise the whole file is hashed: the same hash only refreshes the record, since the file was
 * merely copied or touched, and a new hash means it was replaced and is measured again.
 * @param {ScannedAudio} audio
 * @param {AudioOptions | undefined} options
 * @param {MeasureIo} [io]
 * @returns {Promise<Measurement | null>} null when the stored values are still right
 */
export async function measureIfNeeded(audio, options, io = DEFAULT_IO) {
	if (isMeasured(audio, options)) {
		return null;
	}
	const sha1 = await io.hashFile(audio.absolutePath);
	const measuredFrom = { size: audio.size, modified: audio.modified, sha1 };
	if (options && 'duration' in options && options.measuredFrom?.sha1 === sha1) {
		return { duration: options.duration ?? null, measuredFrom };
	}
	const duration = await io.readDuration(audio.absolutePath);
	return { duration: duration === null ? null : Math.round(duration * 100) / 100, measuredFrom };
}

/** @param {string} path */
async function sha1File(path) {
	const hash = createHash('sha1');
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk);
	}
	return hash.digest('hex');
}
