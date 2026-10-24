/**
 * Builders for audio tag bytes, so metadata tests describe their input in code instead of relying on opaque binary fixtures.
 */

/** @typedef {0 | 1 | 2 | 3} Id3TextEncoding ISO-8859-1, UTF-16 with BOM, UTF-16BE, UTF-8 */
/** @typedef {{ id: string, body: Buffer, flags?: [number, number] }} Id3Frame */

/** @param {number} value */
export function syncsafe(value) {
	return Buffer.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f]);
}

/**
 * @param {string} text
 * @param {Id3TextEncoding} encoding
 */
export function encodeId3Text(text, encoding) {
	const bytes = {
		0: () => Buffer.from(text, 'latin1'),
		1: () => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
		2: () => Buffer.from(text, 'utf16le').swap16(),
		3: () => Buffer.from(text, 'utf8'),
	}[encoding]();
	return Buffer.concat([Buffer.from([encoding]), bytes]);
}

/**
 * @param {string} id
 * @param {string} text
 * @param {Id3TextEncoding} [encoding]
 * @returns {Id3Frame}
 */
export function textFrame(id, text, encoding = 0) {
	return { id, body: encodeId3Text(text, encoding) };
}

/**
 * Applies ID3 unsynchronization: a zero byte goes after every 0xFF that is followed by 0x00 or 0b111xxxxx, or that ends the data.
 * @param {Uint8Array} bytes
 */
export function unsynchronize(bytes) {
	const result = [];
	for (let i = 0; i < bytes.length; i++) {
		result.push(bytes[i]);
		const next = bytes[i + 1];
		if (
			bytes[i] === 0xff
			&& (next === undefined || next === 0x00 || next >= 0xe0)
		) {
			result.push(0x00);
		}
	}
	return Buffer.from(result);
}

/**
 * @param {object} options
 * @param {2 | 3 | 4} [options.version]
 * @param {Id3Frame[]} options.frames
 * @param {boolean} [options.unsynchronized] tag-wide unsynchronization, as written by ID3v2.3 taggers
 * @param {boolean} [options.extendedHeader]
 * @param {number} [options.padding]
 */
export function buildId3v2({ version = 4, frames, unsynchronized = false, extendedHeader = false, padding = 0 }) {
	const parts = [];
	if (extendedHeader) {
		parts.push(version === 4
			? Buffer.concat([syncsafe(6), Buffer.from([1, 0])])
			: Buffer.from([0, 0, 0, 6, 0, 0, 0, 0, 0, 0]));
	}
	for (const frame of frames) {
		parts.push(buildFrameHeader(version, frame), frame.body);
	}
	parts.push(Buffer.alloc(padding));

	let body = Buffer.concat(parts);
	if (unsynchronized) {
		body = unsynchronize(body);
	}
	const flags = (unsynchronized ? 0x80 : 0) | (extendedHeader ? 0x40 : 0);
	const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([version, 0, flags]), syncsafe(body.length)]);
	return Buffer.concat([header, body]);
}

/**
 * @param {2 | 3 | 4} version
 * @param {Id3Frame} frame
 */
function buildFrameHeader(version, { id, body, flags = [0, 0] }) {
	const idBytes = Buffer.from(id, 'latin1');
	if (version === 2) {
		const size = Buffer.alloc(3);
		size.writeUIntBE(body.length, 0, 3);
		return Buffer.concat([idBytes, size]);
	}
	let size = syncsafe(body.length);
	if (version === 3) {
		size = Buffer.alloc(4);
		size.writeUInt32BE(body.length);
	}
	return Buffer.concat([idBytes, size, Buffer.from(flags)]);
}

/** @param {string} title */
export function buildId3v1(title) {
	const tag = Buffer.alloc(128);
	tag.write('TAG', 0, 'latin1');
	tag.write(title, 3, 30, 'latin1');
	return tag;
}

const OGG_CODECS = {
	vorbis: { identification: Buffer.from('\x01vorbis', 'latin1'), comments: Buffer.from('\x03vorbis', 'latin1'), framingBit: true },
	opus: { identification: Buffer.from('OpusHead', 'latin1'), comments: Buffer.from('OpusTags', 'latin1'), framingBit: false },
};

/**
 * Builds the identification and comment header packets, followed by one fake audio packet.
 * @param {object} options
 * @param {'vorbis' | 'opus'} [options.codec]
 * @param {string[]} [options.comments] raw `KEY=value` entries
 * @param {string} [options.vendor]
 * @returns {Buffer[]}
 */
export function buildOggHeaderPackets({ codec = 'vorbis', comments = [], vendor = 'test vendor' }) {
	const { identification, comments: commentsPrefix, framingBit } = OGG_CODECS[codec];
	const entries = comments.map((comment) => lengthPrefixed(Buffer.from(comment, 'utf8')));
	const commentPacket = Buffer.concat([
		commentsPrefix,
		lengthPrefixed(Buffer.from(vendor, 'utf8')),
		uint32le(comments.length),
		...entries,
		framingBit ? Buffer.from([1]) : Buffer.alloc(0),
	]);
	return [
		Buffer.concat([identification, Buffer.alloc(22, 0x11)]),
		commentPacket,
		Buffer.alloc(300, 0x55),
	];
}

/**
 * Splits packets into Ogg pages. A small `maxSegmentsPerPage` forces packets to span several pages.
 * @param {Buffer[]} packets
 * @param {object} [options]
 * @param {number} [options.serial]
 * @param {number} [options.maxSegmentsPerPage]
 * @returns {Buffer[]}
 */
export function buildOggPages(packets, { serial = 1, maxSegmentsPerPage = 255 } = {}) {
	/** @type {{ lace: number, data: Buffer, continuesPacket: boolean }[]} */
	const segments = [];
	for (const packet of packets) {
		const laceCount = Math.floor(packet.length / 255) + 1;
		for (let i = 0; i < laceCount; i++) {
			const data = packet.subarray(i * 255, Math.min((i + 1) * 255, packet.length));
			segments.push({ lace: data.length, data, continuesPacket: i > 0 });
		}
	}

	const pages = [];
	for (let start = 0; start < segments.length; start += maxSegmentsPerPage) {
		const pageSegments = segments.slice(start, start + maxSegmentsPerPage);
		const header = Buffer.alloc(27);
		header.write('OggS', 0, 'latin1');
		header[5] = (pageSegments[0].continuesPacket ? 0x01 : 0) | (start === 0 ? 0x02 : 0);
		header.writeUInt32LE(serial, 14);
		header.writeUInt32LE(pages.length, 18);
		header[26] = pageSegments.length;
		pages.push(Buffer.concat([
			header,
			Buffer.from(pageSegments.map((segment) => segment.lace)),
			...pageSegments.map((segment) => segment.data),
		]));
	}
	return pages;
}

/** @param {Parameters<typeof buildOggHeaderPackets>[0] & Parameters<typeof buildOggPages>[1]} options */
export function buildOgg(options) {
	return Buffer.concat(buildOggPages(buildOggHeaderPackets(options), options));
}

/** @param {Buffer} bytes */
function lengthPrefixed(bytes) {
	return Buffer.concat([uint32le(bytes.length), bytes]);
}

/** @param {number} value */
function uint32le(value) {
	const bytes = Buffer.alloc(4);
	bytes.writeUInt32LE(value);
	return bytes;
}
