import { gunzipSync } from 'node:zlib';

/** @typedef {{ path: string, mode: number, data: Buffer }} TarFile */

const BLOCK = 512;
const REGULAR_FILE = new Set(['0', '\0']);
const GNU_LONG_NAME = 'L';
const PAX_HEADER = 'x';

/**
 * The regular files in a `.tar.gz`, with their paths as stored. Links, folders and other entries are skipped: a
 * release only needs plain files out of Node's archives.
 * @param {Buffer} archive
 * @returns {TarFile[]}
 */
export function readTarGz(archive) {
	const tar = gunzipSync(archive);
	/** @type {TarFile[]} */
	const files = [];
	/** @type {string | null} a long name from a GNU or pax header, which applies to the entry that follows */
	let nextPath = null;
	let offset = 0;
	while (offset + BLOCK <= tar.length) {
		const header = tar.subarray(offset, offset + BLOCK);
		if (header.every((byte) => byte === 0)) {
			break;
		}
		const size = octal(header.subarray(124, 136));
		const type = String.fromCharCode(header[156]);
		const data = tar.subarray(offset + BLOCK, offset + BLOCK + size);
		offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

		if (type === GNU_LONG_NAME) {
			nextPath = text(data);
			continue;
		}
		if (type === PAX_HEADER) {
			nextPath = paxPath(data) ?? nextPath;
			continue;
		}
		const prefix = text(header.subarray(345, 500));
		const name = text(header.subarray(0, 100));
		const path = nextPath ?? (prefix ? `${prefix}/${name}` : name);
		nextPath = null;
		if (REGULAR_FILE.has(type)) {
			files.push({ path, mode: octal(header.subarray(100, 108)), data });
		}
	}
	return files;
}

/**
 * @param {Buffer} field
 * @returns {number}
 */
function octal(field) {
	const value = text(field).trim();
	return value ? Number.parseInt(value, 8) : 0;
}

/**
 * @param {Buffer} field
 * @returns {string} the field up to its first NUL
 */
function text(field) {
	const end = field.indexOf(0);
	return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

/**
 * @param {Buffer} data pax records, each `<length> <key>=<value>\n`
 * @returns {string | null}
 */
function paxPath(data) {
	let offset = 0;
	while (offset < data.length) {
		const space = data.indexOf(0x20, offset);
		const length = Number.parseInt(data.subarray(offset, space).toString('utf8'), 10);
		if (space === -1 || !(length > 0)) {
			return null;
		}
		const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
		if (record.startsWith('path=')) {
			return record.slice('path='.length);
		}
		offset += length;
	}
	return null;
}
