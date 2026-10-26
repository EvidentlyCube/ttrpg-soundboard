import { hasId3v1, readId3v2End } from './id3.js';

/** @typedef {import('./binary-reader.js').ByteSource} ByteSource */

/**
 * @typedef {object} FrameHeader
 * @property {1 | 2 | 2.5} version
 * @property {number} bitrate bits per second
 * @property {number} sampleRate
 * @property {number} samplesPerFrame
 * @property {number} length bytes, including the header
 * @property {boolean} mono
 */

// Audio may start a little after the ID3 tag (padding, junk); a first frame further away than this is not looked for.
const SEARCH_LIMIT = 64 * 1024;
const HEADER_LENGTH = 4;
const XING_LENGTH = 12;
const VBRI_OFFSET = HEADER_LENGTH + 32;
const VBRI_LENGTH = 18;

/** Indexed by the two version bits; 0b01 is reserved. */
const VERSIONS = /** @type {const} */ ([2.5, null, 2, 1]);
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };
/** Layer III bitrates in kbit/s; index 0 ("free") and 15 are not usable. */
const BITRATES = {
	1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/**
 * The duration of an MPEG audio Layer III file (DESIGN.md §4.3), from a Xing, Info or VBRI header when the first frame
 * has one, and otherwise from the file size and bitrate, as for constant bitrate. Returns null when no frame is found.
 * @param {ByteSource} reader
 * @returns {Promise<number | null>}
 */
export async function readMpegDuration(reader) {
	const audioStart = await readId3v2End(reader);
	const found = await findFirstFrame(reader, audioStart);
	if (!found) {
		return null;
	}
	const { offset, header } = found;
	const frames = await readFrameCount(reader, offset, header);
	if (frames !== null) {
		return (frames * header.samplesPerFrame) / header.sampleRate;
	}
	const audioEnd = reader.size - ((await hasId3v1(reader)) ? 128 : 0);
	return ((audioEnd - offset) * 8) / header.bitrate;
}

/**
 * The first frame header that is followed by another one (or by the end of the file), so stray bytes that happen to
 * look like a header are skipped.
 * @param {ByteSource} reader
 * @param {number} start
 */
async function findFirstFrame(reader, start) {
	const bytes = await reader.read(start, SEARCH_LIMIT);
	for (let i = 0; i + HEADER_LENGTH <= bytes.length; i++) {
		const header = parseFrameHeader(bytes, i);
		if (!header) {
			continue;
		}
		const offset = start + i;
		const nextOffset = offset + header.length;
		if (nextOffset >= reader.size || parseFrameHeader(await reader.read(nextOffset, HEADER_LENGTH), 0)) {
			return { offset, header };
		}
	}
	return null;
}

/**
 * @param {Buffer} bytes
 * @param {number} offset
 * @returns {FrameHeader | null}
 */
function parseFrameHeader(bytes, offset) {
	if (offset + HEADER_LENGTH > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
		return null;
	}
	const version = VERSIONS[(bytes[offset + 1] >> 3) & 0b11];
	const layer = (bytes[offset + 1] >> 1) & 0b11;
	const bitrateIndex = bytes[offset + 2] >> 4;
	const rateIndex = (bytes[offset + 2] >> 2) & 0b11;
	if (version === null || layer !== 0b01 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
		return null;
	}
	const bitrate = BITRATES[version === 1 ? 1 : 2][bitrateIndex] * 1000;
	const sampleRate = SAMPLE_RATES[version][rateIndex];
	const padding = (bytes[offset + 2] >> 1) & 1;
	const samplesPerFrame = version === 1 ? 1152 : 576;
	return {
		version,
		bitrate,
		sampleRate,
		samplesPerFrame,
		length: Math.floor((samplesPerFrame / 8) * bitrate / sampleRate) + padding,
		mono: bytes[offset + 3] >> 6 === 0b11,
	};
}

/**
 * The number of frames from a Xing or Info header (after the side information) or a VBRI header, if the first frame
 * carries one.
 * @param {ByteSource} reader
 * @param {number} offset
 * @param {FrameHeader} header
 */
async function readFrameCount(reader, offset, header) {
	const sideInfo = header.version === 1 ? (header.mono ? 17 : 32) : (header.mono ? 9 : 17);
	const xing = await reader.read(offset + HEADER_LENGTH + sideInfo, XING_LENGTH);
	const tag = xing.toString('latin1', 0, 4);
	if (xing.length === XING_LENGTH && (tag === 'Xing' || tag === 'Info') && (xing.readUInt32BE(4) & 0x1) !== 0) {
		return xing.readUInt32BE(8);
	}
	const vbri = await reader.read(offset + VBRI_OFFSET, VBRI_LENGTH);
	if (vbri.length === VBRI_LENGTH && vbri.toString('latin1', 0, 4) === 'VBRI') {
		return vbri.readUInt32BE(14);
	}
	return null;
}
