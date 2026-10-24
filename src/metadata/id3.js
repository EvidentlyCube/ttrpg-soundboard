import { BufferReader } from './binary-reader.js';

/** @typedef {import('./binary-reader.js').ByteSource} ByteSource */

const HEADER_LENGTH = 10;
const ID3V1_LENGTH = 128;
const MAX_UNSYNCHRONIZED_TAG_LENGTH = 2 * 1024 * 1024;
const MAX_TITLE_FRAME_LENGTH = 64 * 1024;

const TAG_FLAG_UNSYNCHRONIZED = 0x80;
const TAG_FLAG_EXTENDED_HEADER = 0x40;

/** @type {Record<number, { titleId: string, idLength: number, headerLength: number }>} */
const FRAME_LAYOUTS = {
	2: { titleId: 'TT2', idLength: 3, headerLength: 6 },
	3: { titleId: 'TIT2', idLength: 4, headerLength: 10 },
	4: { titleId: 'TIT2', idLength: 4, headerLength: 10 },
};

/**
 * Reads the title from an ID3v2 tag, falling back to ID3v1. Returns null for missing or malformed tags.
 * @param {ByteSource} reader
 * @returns {Promise<string | null>}
 */
export async function readId3Title(reader) {
	return (await readId3v2Title(reader)) ?? (await readId3v1Title(reader));
}

/** @param {ByteSource} reader */
async function readId3v2Title(reader) {
	const header = await reader.read(0, HEADER_LENGTH);
	if (header.length < HEADER_LENGTH || header.toString('latin1', 0, 3) !== 'ID3') {
		return null;
	}
	const version = header[3];
	const layout = FRAME_LAYOUTS[version];
	if (!layout) {
		return null;
	}
	const flags = header[5];
	let tagEnd = HEADER_LENGTH + readSyncsafe(header, 6);
	if (tagEnd > reader.size) {
		return null;
	}

	let source = reader;
	const tagUnsynchronized = (flags & TAG_FLAG_UNSYNCHRONIZED) !== 0;
	// ID3v2.4 marks unsynchronization per frame, but earlier versions apply it to the whole tag including frame headers.
	if (tagUnsynchronized && version < 4) {
		if (tagEnd > MAX_UNSYNCHRONIZED_TAG_LENGTH) {
			return null;
		}
		const tag = await reader.read(0, tagEnd);
		source = new BufferReader(Buffer.concat([tag.subarray(0, HEADER_LENGTH), resynchronize(tag.subarray(HEADER_LENGTH))]));
		tagEnd = source.size;
	}

	let offset = HEADER_LENGTH;
	if (flags & TAG_FLAG_EXTENDED_HEADER) {
		// In ID3v2.2 this bit means the tag is compressed, which no known encoder produces.
		if (version === 2) {
			return null;
		}
		const sizeBytes = await source.read(offset, 4);
		if (sizeBytes.length < 4) {
			return null;
		}
		offset += version === 4 ? readSyncsafe(sizeBytes, 0) : 4 + sizeBytes.readUInt32BE(0);
	}

	while (offset + layout.headerLength <= tagEnd) {
		const frameHeader = await source.read(offset, layout.headerLength);
		if (frameHeader.length < layout.headerLength || frameHeader[0] === 0) {
			return null;
		}
		const frameLength = readFrameLength(frameHeader, version);
		const bodyStart = offset + layout.headerLength;
		if (bodyStart + frameLength > tagEnd) {
			return null;
		}
		if (frameHeader.toString('latin1', 0, layout.idLength) === layout.titleId) {
			if (frameLength > MAX_TITLE_FRAME_LENGTH) {
				return null;
			}
			const body = await source.read(bodyStart, frameLength);
			return decodeTitleFrame(body, version, version === 2 ? 0 : frameHeader[9], tagUnsynchronized);
		}
		offset = bodyStart + frameLength;
	}
	return null;
}

/**
 * @param {Buffer} frameHeader
 * @param {number} version
 */
function readFrameLength(frameHeader, version) {
	if (version === 2) {
		return frameHeader.readUIntBE(3, 3);
	}
	return version === 4 ? readSyncsafe(frameHeader, 4) : frameHeader.readUInt32BE(4);
}

/**
 * @param {Buffer} body
 * @param {number} version
 * @param {number} formatFlags the second frame flag byte
 * @param {boolean} tagUnsynchronized
 */
function decodeTitleFrame(body, version, formatFlags, tagUnsynchronized) {
	if (version === 3) {
		const COMPRESSED = 0x80, ENCRYPTED = 0x40, GROUPED = 0x20;
		if (formatFlags & (COMPRESSED | ENCRYPTED)) {
			return null;
		}
		return decodeText(formatFlags & GROUPED ? body.subarray(1) : body);
	}
	if (version === 4) {
		const GROUPED = 0x40, COMPRESSED = 0x08, ENCRYPTED = 0x04, UNSYNCHRONIZED = 0x02, DATA_LENGTH = 0x01;
		if (formatFlags & (COMPRESSED | ENCRYPTED)) {
			return null;
		}
		let data = body.subarray((formatFlags & GROUPED ? 1 : 0) + (formatFlags & DATA_LENGTH ? 4 : 0));
		if (formatFlags & UNSYNCHRONIZED || tagUnsynchronized) {
			data = resynchronize(data);
		}
		return decodeText(data);
	}
	return decodeText(body);
}

/**
 * Decodes an ID3 text frame body: an encoding byte followed by one or more null-separated strings.
 * @param {Buffer} body
 */
function decodeText(body) {
	if (body.length < 1) {
		return null;
	}
	const data = body.subarray(1);
	let text;
	switch (body[0]) {
		case 0:
			text = data.toString('latin1');
			break;
		case 1:
			text = decodeUtf16WithBom(data);
			break;
		case 2:
			text = decodeUtf16BigEndian(data);
			break;
		case 3:
			text = data.toString('utf8');
			break;
		default:
			return null;
	}
	return text.split('\0')[0].trim() || null;
}

/** @param {Buffer} data */
function decodeUtf16WithBom(data) {
	if (data[0] === 0xfe && data[1] === 0xff) {
		return decodeUtf16BigEndian(data.subarray(2));
	}
	const hasLittleEndianBom = data[0] === 0xff && data[1] === 0xfe;
	return data.subarray(hasLittleEndianBom ? 2 : 0).toString('utf16le');
}

/** @param {Buffer} data */
function decodeUtf16BigEndian(data) {
	const evenLength = data.length - (data.length % 2);
	return Buffer.from(data.subarray(0, evenLength)).swap16().toString('utf16le');
}

/** @param {ByteSource} reader */
async function readId3v1Title(reader) {
	if (reader.size < ID3V1_LENGTH) {
		return null;
	}
	const tag = await reader.read(reader.size - ID3V1_LENGTH, ID3V1_LENGTH);
	if (tag.toString('latin1', 0, 3) !== 'TAG') {
		return null;
	}
	return tag.toString('latin1', 3, 33).split('\0')[0].trim() || null;
}

/**
 * @param {Buffer} bytes
 * @param {number} offset
 */
function readSyncsafe(bytes, offset) {
	return ((bytes[offset] & 0x7f) << 21)
		| ((bytes[offset + 1] & 0x7f) << 14)
		| ((bytes[offset + 2] & 0x7f) << 7)
		| (bytes[offset + 3] & 0x7f);
}

/**
 * Reverses unsynchronization by dropping the zero byte that follows every 0xFF.
 * @param {Buffer} bytes
 */
function resynchronize(bytes) {
	const result = Buffer.alloc(bytes.length);
	let length = 0;
	for (let i = 0; i < bytes.length; i++) {
		result[length++] = bytes[i];
		if (bytes[i] === 0xff && bytes[i + 1] === 0x00) {
			i++;
		}
	}
	return result.subarray(0, length);
}
