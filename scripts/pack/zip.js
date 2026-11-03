import { crc32, deflateRawSync } from 'node:zlib';

/** A regular file that anyone may read. */
export const FILE_MODE = 0o100644;
/** A regular file that anyone may read and run. */
export const EXECUTABLE_MODE = 0o100755;

/** @typedef {{ path: string, data: Buffer, mode?: number }} ZipEntry `path` uses forward slashes */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const VERSION_NEEDED = 20;
// The high byte 3 says "made on Unix", which is what makes unzip and macOS's Archive Utility read the permissions
// from the external attributes.
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED;
const UTF8_NAMES = 0x0800;
const STORED = 0;
const DEFLATED = 8;
// Without Zip64, sizes, offsets and the entry count must fit their 32-bit and 16-bit fields.
const MAX_SIZE = 0xffffffff;
const MAX_ENTRIES = 0xffff;

/**
 * Builds a zip archive in memory. Every entry gets the same timestamp, so the same input always gives the same bytes.
 * @param {ZipEntry[]} entries
 * @param {Date} date stored as UTC, since zip timestamps have no time zone
 * @returns {Buffer}
 */
export function createZip(entries, date) {
	if (entries.length > MAX_ENTRIES) {
		throw new Error(`A zip without Zip64 holds at most ${MAX_ENTRIES} entries, not ${entries.length}.`);
	}
	const { time, day } = dosDateTime(date);
	/** @type {Buffer[]} */
	const chunks = [];
	/** @type {Buffer[]} */
	const centralHeaders = [];
	let offset = 0;
	for (const { path, data, mode = FILE_MODE } of entries) {
		const name = Buffer.from(path, 'utf8');
		const deflated = deflateRawSync(data, { level: 9 });
		const method = deflated.length < data.length ? DEFLATED : STORED;
		const body = method === DEFLATED ? deflated : data;
		if (data.length > MAX_SIZE || offset > MAX_SIZE) {
			throw new Error(`${path} does not fit in a zip without Zip64.`);
		}
		const checksum = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL_HEADER, 0);
		local.writeUInt16LE(VERSION_NEEDED, 4);
		local.writeUInt16LE(UTF8_NAMES, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(day, 12);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(CENTRAL_HEADER, 0);
		central.writeUInt16LE(VERSION_MADE_BY, 4);
		central.writeUInt16LE(VERSION_NEEDED, 6);
		central.writeUInt16LE(UTF8_NAMES, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(day, 14);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE((mode << 16) >>> 0, 38);
		central.writeUInt32LE(offset, 42);

		chunks.push(local, name, body);
		centralHeaders.push(central, name);
		offset += local.length + name.length + body.length;
	}
	const centralSize = centralHeaders.reduce((total, chunk) => total + chunk.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, ...centralHeaders, end]);
}

/**
 * @param {Date} date
 * @returns {{ time: number, day: number }} MS-DOS time and date fields
 */
function dosDateTime(date) {
	const year = date.getUTCFullYear();
	if (year < 1980 || year > 2107) {
		throw new Error(`A zip timestamp must be between 1980 and 2107, not ${year}.`);
	}
	return {
		time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
		day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
	};
}
