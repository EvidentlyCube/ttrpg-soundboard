import { BufferReader } from './binary-reader.js';

/** @typedef {import('./binary-reader.js').ByteSource} ByteSource */

const HEADER_LENGTH = 10;
const ID3V1_LENGTH = 128;
const MAX_UNSYNCHRONIZED_TAG_LENGTH = 2 * 1024 * 1024;
const MAX_FRAME_LENGTH = 64 * 1024;

const TAG_FLAG_UNSYNCHRONIZED = 0x80;
const TAG_FLAG_EXTENDED_HEADER = 0x40;
const TAG_FLAG_FOOTER = 0x10;

/** @typedef {'title' | 'link' | 'userLink' | 'userText' | 'comment'} FrameKind */

/**
 * Frame ids by kind, per ID3v2 version. The link frames are where `yt-dlp --embed-metadata` and taggers put a file's
 * page (DESIGN.md §4.1).
 * @type {Record<number, { ids: Record<string, FrameKind>, idLength: number, headerLength: number }>}
 */
const FRAME_LAYOUTS = {
	2: { ids: { TT2: 'title', WAS: 'link', WXX: 'userLink', TXX: 'userText', COM: 'comment' }, idLength: 3, headerLength: 6 },
	3: { ids: { TIT2: 'title', WOAS: 'link', WXXX: 'userLink', TXXX: 'userText', COMM: 'comment' }, idLength: 4, headerLength: 10 },
	4: { ids: { TIT2: 'title', WOAS: 'link', WXXX: 'userLink', TXXX: 'userText', COMM: 'comment' }, idLength: 4, headerLength: 10 },
};

/** Which frames are searched for a link, best first (DESIGN.md §4.1). */
const LINK_ORDER = /** @type {const} */ (['userLink', 'userText', 'link', 'comment']);
const LINK = /https?:\/\/[^\s\0"<>]+/;

/**
 * Reads the title from an ID3v2 tag, falling back to ID3v1. Returns null for missing or malformed tags.
 * @param {ByteSource} reader
 * @returns {Promise<string | null>}
 */
export async function readId3Title(reader) {
	const title = (await readId3v2Frames(reader, (kind) => kind === 'title')).find((frame) => frame.kind === 'title');
	return (title ? decodeText(title.data) : null) ?? (await readId3v1Title(reader));
}

/**
 * Reads the first `http(s)` link from the ID3v2 frames where a file's page is kept: a user link (`WXXX`), a user text
 * frame named "purl" (`TXXX`), the official source link (`WOAS`), then a comment (`COMM`). Returns null when none holds one.
 * @param {ByteSource} reader
 * @returns {Promise<string | null>}
 */
export async function readId3SourceLink(reader) {
	const frames = await readId3v2Frames(reader, (kind) => kind !== 'title');
	for (const kind of LINK_ORDER) {
		for (const frame of frames.filter((entry) => entry.kind === kind)) {
			const link = linkInFrame(frame.kind, frame.data);
			if (link !== null) {
				return link;
			}
		}
	}
	return null;
}

/**
 * @param {FrameKind} kind
 * @param {Buffer} data the frame's body, flags undone
 * @returns {string | null}
 */
function linkInFrame(kind, data) {
	switch (kind) {
		case 'link':
		case 'userLink':
			// URLs are always ISO-8859-1. A user link has an encoding byte and a description before it, which searching
			// the raw bytes skips over.
			return LINK.exec(data.toString('latin1'))?.[0] ?? null;
		case 'userText': {
			const [description, ...values] = decodeStrings(data) ?? [];
			return description?.trim().toLowerCase() === 'purl' ? LINK.exec(values.join(' '))?.[0] ?? null : null;
		}
		case 'comment': {
			// An encoding byte, a three-letter language, a short description, then the text.
			if (data.length < 4) {
				return null;
			}
			const strings = decodeStrings(Buffer.concat([data.subarray(0, 1), data.subarray(4)]));
			return LINK.exec((strings ?? []).join(' '))?.[0] ?? null;
		}
		default:
			return null;
	}
}

/**
 * Where the audio after a leading ID3v2 tag starts: 0 without a tag. Counts the footer that ID3v2.4 tags may have.
 * @param {ByteSource} reader
 */
export async function readId3v2End(reader) {
	const header = await reader.read(0, HEADER_LENGTH);
	if (header.length < HEADER_LENGTH || header.toString('latin1', 0, 3) !== 'ID3') {
		return 0;
	}
	const footer = (header[5] & TAG_FLAG_FOOTER) !== 0 ? HEADER_LENGTH : 0;
	return HEADER_LENGTH + readSyncsafe(header, 6) + footer;
}

/**
 * Whether the file ends in a 128-byte ID3v1 tag.
 * @param {ByteSource} reader
 */
export async function hasId3v1(reader) {
	if (reader.size < ID3V1_LENGTH) {
		return false;
	}
	const tag = await reader.read(reader.size - ID3V1_LENGTH, 3);
	return tag.toString('latin1') === 'TAG';
}

/**
 * Walks the ID3v2 frames, reading the bodies of the wanted kinds only, with their flags undone. Stops at padding, at a
 * malformed frame, or at the end of the tag, keeping what was found so far. Frames too large, compressed or encrypted
 * are skipped.
 * @param {ByteSource} reader
 * @param {(kind: FrameKind) => boolean} wanted
 * @returns {Promise<{ kind: FrameKind, data: Buffer }[]>}
 */
async function readId3v2Frames(reader, wanted) {
	/** @type {{ kind: FrameKind, data: Buffer }[]} */
	const found = [];
	const header = await reader.read(0, HEADER_LENGTH);
	if (header.length < HEADER_LENGTH || header.toString('latin1', 0, 3) !== 'ID3') {
		return found;
	}
	const version = header[3];
	const layout = FRAME_LAYOUTS[version];
	if (!layout) {
		return found;
	}
	const flags = header[5];
	let tagEnd = HEADER_LENGTH + readSyncsafe(header, 6);
	if (tagEnd > reader.size) {
		return found;
	}

	let source = reader;
	const tagUnsynchronized = (flags & TAG_FLAG_UNSYNCHRONIZED) !== 0;
	// ID3v2.4 marks unsynchronization per frame, but earlier versions apply it to the whole tag including frame headers.
	if (tagUnsynchronized && version < 4) {
		if (tagEnd > MAX_UNSYNCHRONIZED_TAG_LENGTH) {
			return found;
		}
		const tag = await reader.read(0, tagEnd);
		source = new BufferReader(Buffer.concat([tag.subarray(0, HEADER_LENGTH), resynchronize(tag.subarray(HEADER_LENGTH))]));
		tagEnd = source.size;
	}

	let offset = HEADER_LENGTH;
	if (flags & TAG_FLAG_EXTENDED_HEADER) {
		// In ID3v2.2 this bit means the tag is compressed, which no known encoder produces.
		if (version === 2) {
			return found;
		}
		const sizeBytes = await source.read(offset, 4);
		if (sizeBytes.length < 4) {
			return found;
		}
		offset += version === 4 ? readSyncsafe(sizeBytes, 0) : 4 + sizeBytes.readUInt32BE(0);
	}

	while (offset + layout.headerLength <= tagEnd) {
		const frameHeader = await source.read(offset, layout.headerLength);
		if (frameHeader.length < layout.headerLength || frameHeader[0] === 0) {
			return found;
		}
		const frameLength = readFrameLength(frameHeader, version);
		const bodyStart = offset + layout.headerLength;
		if (bodyStart + frameLength > tagEnd) {
			return found;
		}
		const kind = layout.ids[frameHeader.toString('latin1', 0, layout.idLength)];
		if (kind !== undefined && wanted(kind) && frameLength <= MAX_FRAME_LENGTH) {
			const body = await source.read(bodyStart, frameLength);
			const data = unwrapFrame(body, version, version === 2 ? 0 : frameHeader[9], tagUnsynchronized);
			if (data !== null) {
				found.push({ kind, data });
			}
		}
		offset = bodyStart + frameLength;
	}
	return found;
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
 * Undoes a frame's own flags: group byte, data length indicator and unsynchronization. Compressed or encrypted frames
 * can't be read, so they are null.
 * @param {Buffer} body
 * @param {number} version
 * @param {number} formatFlags the second frame flag byte
 * @param {boolean} tagUnsynchronized
 * @returns {Buffer | null}
 */
function unwrapFrame(body, version, formatFlags, tagUnsynchronized) {
	if (version === 3) {
		const COMPRESSED = 0x80, ENCRYPTED = 0x40, GROUPED = 0x20;
		if (formatFlags & (COMPRESSED | ENCRYPTED)) {
			return null;
		}
		return formatFlags & GROUPED ? body.subarray(1) : body;
	}
	if (version === 4) {
		const GROUPED = 0x40, COMPRESSED = 0x08, ENCRYPTED = 0x04, UNSYNCHRONIZED = 0x02, DATA_LENGTH = 0x01;
		if (formatFlags & (COMPRESSED | ENCRYPTED)) {
			return null;
		}
		const data = body.subarray((formatFlags & GROUPED ? 1 : 0) + (formatFlags & DATA_LENGTH ? 4 : 0));
		return formatFlags & UNSYNCHRONIZED || tagUnsynchronized ? resynchronize(data) : data;
	}
	return body;
}

/**
 * Decodes an ID3 text frame body: an encoding byte followed by one or more null-separated strings. Returns the first.
 * @param {Buffer} body
 */
function decodeText(body) {
	return decodeStrings(body)?.[0].trim() || null;
}

/**
 * @param {Buffer} body an encoding byte, then null-separated strings in that encoding
 * @returns {string[] | null} null for an unknown encoding
 */
function decodeStrings(body) {
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
	return text.split('\0');
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
