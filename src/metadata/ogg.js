/** @typedef {import('./binary-reader.js').ByteSource} ByteSource */

const PAGE_HEADER_LENGTH = 27;
// Comment packets can embed cover art, so reading stops here and whatever part of the comments arrived is parsed.
const MAX_BYTES_READ = 1024 * 1024;
const TAIL_BYTES = 128 * 1024;

const CODECS = [
	{ identification: Buffer.from('\x01vorbis', 'latin1'), comments: Buffer.from('\x03vorbis', 'latin1') },
	{ identification: Buffer.from('OpusHead', 'latin1'), comments: Buffer.from('OpusTags', 'latin1') },
];

/**
 * Reads the TITLE comment from an Ogg Vorbis or Ogg Opus file. Returns null for missing or malformed data.
 * @param {ByteSource} reader
 * @returns {Promise<string | null>}
 */
export async function readOggTitle(reader) {
	const [identification, comments] = await readHeaderPackets(reader);
	const codec = CODECS.find((candidate) => startsWith(identification, candidate.identification));
	if (!codec || !startsWith(comments, codec.comments)) {
		return null;
	}
	return findTitleComment(comments.subarray(codec.comments.length));
}

/**
 * The duration of an Ogg Vorbis or Opus file (DESIGN.md §4.3): the granule position of the first stream's last page,
 * in samples, divided by the sample rate. Only the start and the last 128 KB are read. Returns null when either part
 * cannot be found.
 * @param {ByteSource} reader
 * @returns {Promise<number | null>}
 */
export async function readOggDuration(reader) {
	const firstPage = await reader.read(0, PAGE_HEADER_LENGTH);
	if (firstPage.length < PAGE_HEADER_LENGTH || firstPage.toString('latin1', 0, 4) !== 'OggS') {
		return null;
	}
	const [identification] = await readHeaderPackets(reader, 1);
	const clock = sampleClockOf(identification);
	const granule = clock && (await findLastGranule(reader, firstPage.readUInt32LE(14)));
	if (!clock || granule === null) {
		return null;
	}
	return Math.max(0, granule - clock.preSkip) / clock.sampleRate;
}

/**
 * Opus always counts granules at 48 kHz, starting after the pre-skip; Vorbis counts at its own sample rate.
 * @param {Buffer | undefined} identification
 * @returns {{ sampleRate: number, preSkip: number } | null}
 */
function sampleClockOf(identification) {
	if (startsWith(identification, CODECS[0].identification) && identification && identification.length >= 16) {
		const sampleRate = identification.readUInt32LE(12);
		return sampleRate > 0 ? { sampleRate, preSkip: 0 } : null;
	}
	if (startsWith(identification, CODECS[1].identification) && identification && identification.length >= 12) {
		return { sampleRate: 48000, preSkip: identification.readUInt16LE(10) };
	}
	return null;
}

/**
 * The granule position of the last page of the stream that has one. A page is at most about 64 KB, so the final 128 KB
 * always hold the start of at least one whole page.
 * @param {ByteSource} reader
 * @param {number} serial
 * @returns {Promise<number | null>}
 */
async function findLastGranule(reader, serial) {
	const start = Math.max(0, reader.size - TAIL_BYTES);
	const tail = await reader.read(start, TAIL_BYTES);
	for (let i = tail.length - PAGE_HEADER_LENGTH; i >= 0; i--) {
		if (
			tail[i] === 0x4f
			&& tail.toString('latin1', i, i + 4) === 'OggS'
			&& tail[i + 4] === 0
			&& tail.readUInt32LE(i + 14) === serial
		) {
			// -1 means no packet ends on this page, so it says nothing about the length.
			const granule = tail.readBigInt64LE(i + 6);
			if (granule >= 0n) {
				return Number(granule);
			}
		}
	}
	return null;
}

/**
 * Returns the first packets of the first logical stream. The last one may be truncated by the read limit.
 * @param {ByteSource} reader
 * @param {number} [count]
 * @returns {Promise<Buffer[]>}
 */
async function readHeaderPackets(reader, count = 2) {
	/** @type {Buffer[]} */
	const packets = [];
	/** @type {Buffer[]} */
	let pending = [];
	/** @type {number | null} */
	let streamSerial = null;
	let position = 0;

	while (packets.length < count && position < MAX_BYTES_READ) {
		const header = await reader.read(position, PAGE_HEADER_LENGTH);
		if (
			header.length < PAGE_HEADER_LENGTH
			|| header.toString('latin1', 0, 4) !== 'OggS'
			|| header[4] !== 0
		) {
			break;
		}
		const segmentCount = header[26];
		const lacing = await reader.read(position + PAGE_HEADER_LENGTH, segmentCount);
		const dataStart = position + PAGE_HEADER_LENGTH + segmentCount;
		const dataLength = lacing.reduce((sum, lace) => sum + lace, 0);
		position = dataStart + dataLength;

		const serial = header.readUInt32LE(14);
		streamSerial ??= serial;
		if (serial !== streamSerial) {
			continue;
		}

		const data = await reader.read(dataStart, dataLength);
		let offset = 0;
		for (const lace of lacing) {
			pending.push(data.subarray(offset, offset + lace));
			offset += lace;
			// A lace shorter than 255 ends the packet; a full one means the packet continues.
			if (lace < 255) {
				packets.push(Buffer.concat(pending));
				pending = [];
				if (packets.length === count) {
					break;
				}
			}
		}
	}

	if (packets.length === count - 1 && pending.length > 0) {
		packets.push(Buffer.concat(pending));
	}
	return packets;
}

/**
 * Parses a Vorbis comment block (vendor string, then length-prefixed `KEY=value` entries), stopping safely at truncation.
 * @param {Buffer} data
 */
function findTitleComment(data) {
	let offset = 0;
	/** @returns {number | null} */
	const readLength = () => {
		if (offset + 4 > data.length) {
			return null;
		}
		const value = data.readUInt32LE(offset);
		offset += 4;
		return value;
	};

	const vendorLength = readLength();
	if (vendorLength === null) {
		return null;
	}
	offset += vendorLength;
	const count = readLength();
	if (count === null) {
		return null;
	}

	for (let i = 0; i < count; i++) {
		const length = readLength();
		if (length === null || offset + length > data.length) {
			return null;
		}
		const entry = data.toString('utf8', offset, offset + length);
		offset += length;
		const separator = entry.indexOf('=');
		if (separator > 0 && entry.slice(0, separator).toUpperCase() === 'TITLE') {
			const title = entry.slice(separator + 1).trim();
			if (title) {
				return title;
			}
		}
	}
	return null;
}

/**
 * @param {Buffer | undefined} bytes
 * @param {Buffer} prefix
 */
function startsWith(bytes, prefix) {
	return bytes !== undefined && bytes.length >= prefix.length && bytes.subarray(0, prefix.length).equals(prefix);
}
