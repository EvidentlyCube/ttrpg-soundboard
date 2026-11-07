import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checkClaimedFormat, formatOfExtension, IMAGE_FORMATS, InvalidImageError, inspectImageFile } from './image-info.js';

/** @typedef {import('./image-info.js').ImageFormat} ImageFormat */

/**
 * @typedef {object} Background an image shown behind a tile (DESIGN.md §2.1)
 * @property {string} absolutePath
 * @property {ImageFormat} format
 * @property {number} size bytes
 * @property {string} modified the modification time, as an ISO 8601 string
 * @property {number} width
 * @property {number} height
 */

const INFIX = '.bg.';

/**
 * The file name of an item's background: the item's own name with `.bg.<extension>` added, so `Combat/` gets
 * `Combat.bg.png`.
 * @param {string} ownerName
 * @param {ImageFormat} format
 */
export function backgroundNameFor(ownerName, format) {
	return `${ownerName}${INFIX}${IMAGE_FORMATS[format].extension}`;
}

/**
 * Whose background a file name would be, when it has the shape of one.
 * @param {string} name
 * @returns {string | null} the owner's name
 */
export function backgroundOwnerOf(name) {
	const at = name.lastIndexOf(INFIX);
	if (at <= 0 || formatOfExtension(name.slice(at + INFIX.length)) === null) {
		return null;
	}
	return name.slice(0, at);
}

/**
 * Every file in a directory that is an item's background, whatever its extension.
 * @param {string} directory
 * @param {string} ownerName
 * @returns {Promise<string[]>} absolute paths, sorted
 */
export async function findBackgroundFiles(directory, ownerName) {
	const entries = await readdir(directory, { withFileTypes: true }).catch((/** @type {NodeJS.ErrnoException} */ error) => {
		if (error.code === 'ENOENT') {
			return [];
		}
		throw error;
	});
	return entries
		.filter((entry) => entry.isFile() && backgroundOwnerOf(entry.name) === ownerName)
		.map((entry) => join(directory, entry.name))
		.toSorted();
}

/**
 * Reads a background, or null when it can't be shown. For files the app moved back from the trash, which it never
 * refuses to restore over an image.
 * @param {string} absolutePath
 * @returns {Promise<Background | null>}
 */
export function readBackgroundLeniently(absolutePath) {
	return readBackground(absolutePath).catch((error) => {
		if (error instanceof InvalidImageError) {
			return null;
		}
		throw error;
	});
}

/**
 * Reads a background file's header and checks it as an upload would be: size, format, dimensions, and an extension
 * that names the format it really has.
 * @param {string} absolutePath
 * @returns {Promise<Background>}
 */
export async function readBackground(absolutePath) {
	const info = await inspectImageFile(absolutePath);
	const name = basename(absolutePath);
	const claimed = formatOfExtension(name.slice(name.lastIndexOf('.')));
	if (claimed !== null) {
		checkClaimedFormat(info, claimed);
	}
	return {
		absolutePath,
		format: info.format,
		size: info.size,
		modified: info.modified.toISOString(),
		width: info.width,
		height: info.height,
	};
}
