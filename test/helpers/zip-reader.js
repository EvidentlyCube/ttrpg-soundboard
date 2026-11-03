import { inflateRawSync } from 'node:zlib';

/** @typedef {{ path: string, data: Buffer, mode: number, method: number, date: Date, madeOnUnix: boolean }} ZipFile */

/**
 * Reads a zip without a comment or Zip64, as `createZip` writes them, through its central directory.
 * @param {Buffer} zip
 * @returns {ZipFile[]}
 */
export function readZip(zip) {
	const end = zip.length - 22;
	if (zip.readUInt32LE(end) !== 0x06054b50) {
		throw new Error('No end of central directory record at the end of the zip.');
	}
	const count = zip.readUInt16LE(end + 10);
	let offset = zip.readUInt32LE(end + 16);
	/** @type {ZipFile[]} */
	const files = [];
	for (let index = 0; index < count; index++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error(`No central directory header at ${offset}.`);
		}
		const method = zip.readUInt16LE(offset + 10);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const local = zip.readUInt32LE(offset + 42);
		const localStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		const body = zip.subarray(localStart, localStart + compressedSize);
		files.push({
			path: zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
			data: method === 8 ? inflateRawSync(body) : Buffer.from(body),
			mode: zip.readUInt32LE(offset + 38) >>> 16,
			method,
			date: dosDate(zip.readUInt16LE(offset + 14), zip.readUInt16LE(offset + 12)),
			madeOnUnix: zip.readUInt8(offset + 5) === 3,
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return files;
}

/**
 * @param {number} day
 * @param {number} time
 * @returns {Date}
 */
function dosDate(day, time) {
	return new Date(Date.UTC(
		(day >> 9) + 1980,
		((day >> 5) & 0xf) - 1,
		day & 0x1f,
		time >> 11,
		(time >> 5) & 0x3f,
		(time & 0x1f) * 2,
	));
}
