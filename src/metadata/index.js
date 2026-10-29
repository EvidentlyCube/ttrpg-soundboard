import { extname } from 'node:path';
import { BinaryReader } from './binary-reader.js';
import { readId3SourceLink, readId3Title } from './id3.js';
import { readMpegDuration } from './mpeg.js';
import { readOggDuration, readOggSourceLink, readOggTitle } from './ogg.js';

/** @typedef {import('./binary-reader.js').ByteSource} ByteSource */

/** @type {Record<string, (reader: ByteSource) => Promise<string | null>>} */
const TITLE_READERS = {
	'.mp3': readId3Title,
	'.ogg': readOggTitle,
	'.opus': readOggTitle,
};

/** @type {Record<string, (reader: ByteSource) => Promise<string | null>>} */
const LINK_READERS = {
	'.mp3': readId3SourceLink,
	'.ogg': readOggSourceLink,
	'.opus': readOggSourceLink,
};

/** @type {Record<string, (reader: ByteSource) => Promise<number | null>>} */
const DURATION_READERS = {
	'.mp3': readMpegDuration,
	'.ogg': readOggDuration,
	'.opus': readOggDuration,
};

/**
 * Reads the duration of a supported audio file in seconds, chosen by extension, from small parts of the file.
 * Returns null when it cannot be worked out; only file system errors are thrown.
 * @param {string} filePath
 * @returns {Promise<number | null>}
 */
export async function readDuration(filePath) {
	const readFormatDuration = DURATION_READERS[extname(filePath).toLowerCase()];
	return readFormatDuration ? withReader(filePath, readFormatDuration) : null;
}

/**
 * Reads the embedded title of a supported audio file, chosen by extension.
 * Returns null when the file has no usable title; only file system errors are thrown.
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
export async function readTitle(filePath) {
	const readFormatTitle = TITLE_READERS[extname(filePath).toLowerCase()];
	return readFormatTitle ? withReader(filePath, readFormatTitle) : null;
}

/**
 * Reads the first link to the file's page from its tags, where `yt-dlp --embed-metadata` and taggers keep it
 * (DESIGN.md §4). Returns null when there is none; only file system errors are thrown.
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
export async function readSourceLink(filePath) {
	const readFormatLink = LINK_READERS[extname(filePath).toLowerCase()];
	return readFormatLink ? withReader(filePath, readFormatLink) : null;
}

/**
 * @template T
 * @param {string} filePath
 * @param {(reader: ByteSource) => Promise<T>} read
 * @returns {Promise<T>}
 */
async function withReader(filePath, read) {
	const reader = await BinaryReader.open(filePath);
	try {
		return await read(reader);
	} finally {
		await reader.close();
	}
}
