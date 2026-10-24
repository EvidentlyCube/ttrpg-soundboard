import { extname } from 'node:path';
import { BinaryReader } from './binary-reader.js';
import { readId3Title } from './id3.js';
import { readOggTitle } from './ogg.js';

/** @type {Record<string, (reader: import('./binary-reader.js').ByteSource) => Promise<string | null>>} */
const TITLE_READERS = {
	'.mp3': readId3Title,
	'.ogg': readOggTitle,
};

/**
 * Reads the embedded title of a supported audio file, chosen by extension.
 * Returns null when the file has no usable title; only file system errors are thrown.
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
export async function readTitle(filePath) {
	const readFormatTitle = TITLE_READERS[extname(filePath).toLowerCase()];
	if (!readFormatTitle) {
		return null;
	}
	const reader = await BinaryReader.open(filePath);
	try {
		return await readFormatTitle(reader);
	} finally {
		await reader.close();
	}
}
