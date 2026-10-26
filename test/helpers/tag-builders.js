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

const MP3_VERSIONS = {
	1: { bits: 0b11, rates: [44100, 48000, 32000], bitrates: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], frameFactor: 144 },
	2: { bits: 0b10, rates: [22050, 24000, 16000], bitrates: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], frameFactor: 72 },
	2.5: { bits: 0b00, rates: [11025, 12000, 8000], bitrates: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], frameFactor: 72 },
};

/**
 * One MPEG audio Layer III frame: a real header followed by filler, at the length the header implies.
 * @param {object} [options]
 * @param {1 | 2 | 2.5} [options.version]
 * @param {number} [options.bitrate] kbit/s, one the version supports
 * @param {number} [options.sampleRate]
 * @param {boolean} [options.mono]
 * @param {Buffer} [options.payload] written right after the header, such as a Xing header
 */
export function buildMp3Frame({ version = 1, bitrate = 128, sampleRate, mono = false, payload = Buffer.alloc(0) } = {}) {
	const spec = MP3_VERSIONS[version];
	const rate = sampleRate ?? spec.rates[0];
	const header = Buffer.from([
		0xff,
		0xe0 | (spec.bits << 3) | (0b01 << 1) | 1,
		(spec.bitrates.indexOf(bitrate) << 4) | (spec.rates.indexOf(rate) << 2),
		mono ? 0b11000000 : 0,
	]);
	const length = Math.floor((spec.frameFactor * bitrate * 1000) / rate);
	const frame = Buffer.alloc(length, 0x00);
	header.copy(frame);
	payload.copy(frame, 4);
	return frame;
}

/**
 * The side information that comes before a Xing or Info header, whose size depends on the version and channels.
 * @param {1 | 2 | 2.5} version
 * @param {boolean} mono
 */
export function mp3SideInfoLength(version, mono) {
	if (version === 1) {
		return mono ? 17 : 32;
	}
	return mono ? 9 : 17;
}

/**
 * A Xing (VBR) or Info (CBR, as LAME writes it) header with a frame count, placed after the side information.
 * @param {number} frames
 * @param {object} [options]
 * @param {'Xing' | 'Info'} [options.tag]
 * @param {1 | 2 | 2.5} [options.version]
 * @param {boolean} [options.mono]
 */
export function xingPayload(frames, { tag = 'Xing', version = 1, mono = false } = {}) {
	const body = Buffer.alloc(12);
	body.write(tag, 0, 'latin1');
	body.writeUInt32BE(0x0001, 4);
	body.writeUInt32BE(frames, 8);
	return Buffer.concat([Buffer.alloc(mp3SideInfoLength(version, mono)), body]);
}

/**
 * A VBRI header (written by Fraunhofer encoders), always 32 bytes after the frame header.
 * @param {number} frames
 */
export function vbriPayload(frames) {
	const body = Buffer.alloc(18);
	body.write('VBRI', 0, 'latin1');
	body.writeUInt16BE(1, 4);
	body.writeUInt32BE(frames, 14);
	return Buffer.concat([Buffer.alloc(32), body]);
}

/**
 * The identification packet of a Vorbis or Opus stream with a real sample rate (Vorbis) or pre-skip (Opus).
 * @param {{ codec?: 'vorbis' | 'opus', sampleRate?: number, preSkip?: number }} [options]
 */
export function oggIdentificationPacket({ codec = 'vorbis', sampleRate = 44100, preSkip = 312 } = {}) {
	if (codec === 'opus') {
		const packet = Buffer.alloc(19);
		packet.write('OpusHead', 0, 'latin1');
		packet[8] = 1;
		packet[9] = 2;
		packet.writeUInt16LE(preSkip, 10);
		packet.writeUInt32LE(48000, 12);
		return packet;
	}
	const packet = Buffer.alloc(30);
	packet.write('\x01vorbis', 0, 'latin1');
	packet[11] = 2;
	packet.writeUInt32LE(sampleRate, 12);
	packet[29] = 1;
	return packet;
}

/**
 * A single Ogg page holding one packet, with the given granule position (-1 for "no packet ends here").
 * @param {Buffer} packet
 * @param {object} options
 * @param {bigint} options.granule
 * @param {number} [options.serial]
 * @param {number} [options.sequence]
 * @param {boolean} [options.last] marks the end of the stream
 */
export function buildOggPage(packet, { granule, serial = 1, sequence = 0, last = false }) {
	const lacing = [];
	let remaining = packet.length;
	while (remaining >= 255) {
		lacing.push(255);
		remaining -= 255;
	}
	lacing.push(remaining);
	const header = Buffer.alloc(27);
	header.write('OggS', 0, 'latin1');
	header[5] = (sequence === 0 ? 0x02 : 0) | (last ? 0x04 : 0);
	header.writeBigInt64LE(granule, 6);
	header.writeUInt32LE(serial, 14);
	header.writeUInt32LE(sequence, 18);
	header[26] = lacing.length;
	return Buffer.concat([header, Buffer.from(lacing), packet]);
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
