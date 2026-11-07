import { open } from 'node:fs/promises';
import { extname } from 'node:path';

/** @typedef {'jpeg' | 'png' | 'gif' | 'webp' | 'avif'} ImageFormat */
/** @typedef {{ format: ImageFormat, width: number, height: number }} ImageInfo */

/** The largest image file the app stores, uploaded or downloaded. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
/** The widest or highest image the app stores, in pixels. */
export const MAX_IMAGE_SIDE = 8192;
/** Enough of the file for any header, including a JPEG whose EXIF block comes before its size. */
export const IMAGE_HEADER_BYTES = 256 * 1024;

/** Larger than this is accepted, with a warning (DESIGN.md §5.1). */
const FULL_HD = { long: 1920, short: 1080 };
/** A crafted file can't make the parsers walk forever. */
const MAX_SEGMENTS = 1024;
const MAX_BOXES = 64;

/** @type {Record<ImageFormat, { name: string, extension: string, extensions: string[], type: string }>} */
export const IMAGE_FORMATS = {
	jpeg: { name: 'JPEG', extension: 'jpg', extensions: ['jpg', 'jpeg'], type: 'image/jpeg' },
	png: { name: 'PNG', extension: 'png', extensions: ['png'], type: 'image/png' },
	gif: { name: 'GIF', extension: 'gif', extensions: ['gif'], type: 'image/gif' },
	webp: { name: 'WebP', extension: 'webp', extensions: ['webp'], type: 'image/webp' },
	avif: { name: 'AVIF', extension: 'avif', extensions: ['avif'], type: 'image/avif' },
};

/** An image the app refuses to store or show. `messageCode` lets the page translate it (DESIGN.md §9.21). */
export class InvalidImageError extends Error {
	/**
	 * @param {string} message
	 * @param {'image.format' | 'image.mismatch' | 'image.tooLarge' | 'image.dimensions' | 'image.unreadable'} code
	 * @param {Record<string, string | number>} [params]
	 */
	constructor(message, code, params = {}) {
		super(message);
		this.name = 'InvalidImageError';
		this.messageCode = code;
		this.messageParams = params;
	}
}

/**
 * The format named by a file extension, with or without its dot, in any case.
 * @param {string} extension
 * @returns {ImageFormat | null}
 */
export function formatOfExtension(extension) {
	const bare = extension.replace(/^\./, '').toLowerCase();
	return /** @type {ImageFormat[]} */ (Object.keys(IMAGE_FORMATS)).find((format) => IMAGE_FORMATS[format].extensions.includes(bare)) ?? null;
}

/**
 * @param {string} path a file name or a URL path
 * @returns {ImageFormat | null}
 */
export function formatOfPath(path) {
	return formatOfExtension(extname(path));
}

/**
 * @param {string} type a `Content-Type`, parameters allowed
 * @returns {ImageFormat | null}
 */
export function formatOfType(type) {
	const bare = type.split(';')[0].trim().toLowerCase();
	return /** @type {ImageFormat[]} */ (Object.keys(IMAGE_FORMATS)).find((format) => IMAGE_FORMATS[format].type === bare) ?? null;
}

/**
 * Whether an image is larger than 1080p: more than 1920 px on its longer side or 1080 px on its shorter one, so a
 * portrait 1080 × 1920 image isn't.
 * @param {{ width: number, height: number }} size
 */
export function isLargerThanFullHd({ width, height }) {
	return Math.max(width, height) > FULL_HD.long || Math.min(width, height) > FULL_HD.short;
}

/**
 * Reads an image's format and size from its first bytes alone, never decoding it, and checks the size limit. Every
 * read is checked against the buffer, so a truncated or crafted header is refused rather than misread.
 * @param {Uint8Array} bytes the start of the file; `IMAGE_HEADER_BYTES` is enough
 * @returns {ImageInfo}
 */
export function inspectImage(bytes) {
	const view = new Bytes(bytes);
	const format = detectFormat(view);
	if (format === null) {
		throw new InvalidImageError(
			'This is not a JPEG, PNG, GIF, WebP or AVIF image.',
			'image.format',
		);
	}
	const size = SIZE_READERS[format](view);
	if (size === null || size.width <= 0 || size.height <= 0) {
		throw new InvalidImageError(`The size of this ${IMAGE_FORMATS[format].name} image can't be read.`, 'image.unreadable');
	}
	if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
		throw new InvalidImageError(
			`The image is ${size.width} × ${size.height} px; it may be at most ${MAX_IMAGE_SIDE} px wide and high.`,
			'image.dimensions',
			{ width: size.width, height: size.height, max: MAX_IMAGE_SIDE },
		);
	}
	return { format, ...size };
}

/**
 * Checks that the format the bytes have is the one the file claims, by its extension or type.
 * @param {ImageInfo} info
 * @param {ImageFormat} claimed
 */
export function checkClaimedFormat(info, claimed) {
	if (info.format !== claimed) {
		const params = { claimed: IMAGE_FORMATS[claimed].name, actual: IMAGE_FORMATS[info.format].name };
		throw new InvalidImageError(`This file says it is a ${params.claimed} but is a ${params.actual}.`, 'image.mismatch', params);
	}
}

/** @param {number} size bytes */
export function checkImageBytes(size) {
	if (size > MAX_IMAGE_BYTES) {
		throw tooLargeError();
	}
}

export function tooLargeError() {
	const max = MAX_IMAGE_BYTES / 1024 / 1024;
	return new InvalidImageError(`The image may be at most ${max} MB.`, 'image.tooLarge', { max });
}

/**
 * Checks an image file on disk: its byte size and its header.
 * @param {string} path
 * @returns {Promise<ImageInfo & { size: number, modified: Date }>}
 */
export async function inspectImageFile(path) {
	const handle = await open(path, 'r');
	try {
		const { size, mtime } = await handle.stat();
		checkImageBytes(size);
		const buffer = Buffer.alloc(Math.min(size, IMAGE_HEADER_BYTES));
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return { ...inspectImage(buffer.subarray(0, bytesRead)), size, modified: mtime };
	} finally {
		await handle.close();
	}
}

/** Reads that answer `null` past the end instead of throwing. */
class Bytes {
	/** @param {Uint8Array} bytes */
	constructor(bytes) {
		this.bytes = bytes;
		this.length = bytes.length;
	}

	/** @param {number} at */
	u8(at) {
		return at >= 0 && at < this.length ? this.bytes[at] : null;
	}

	/** @param {number} at */
	u16be(at) {
		return this.#fits(at, 2) ? (this.bytes[at] << 8) | this.bytes[at + 1] : null;
	}

	/** @param {number} at */
	u16le(at) {
		return this.#fits(at, 2) ? this.bytes[at] | (this.bytes[at + 1] << 8) : null;
	}

	/** @param {number} at */
	u24le(at) {
		return this.#fits(at, 3) ? this.bytes[at] | (this.bytes[at + 1] << 8) | (this.bytes[at + 2] << 16) : null;
	}

	/** @param {number} at */
	u32be(at) {
		return this.#fits(at, 4) ? ((this.bytes[at] << 24) >>> 0) + ((this.bytes[at + 1] << 16) | (this.bytes[at + 2] << 8) | this.bytes[at + 3]) : null;
	}

	/** @param {number} at */
	u32le(at) {
		return this.#fits(at, 4) ? ((this.bytes[at + 3] << 24) >>> 0) + ((this.bytes[at + 2] << 16) | (this.bytes[at + 1] << 8) | this.bytes[at]) : null;
	}

	/**
	 * @param {number} at
	 * @param {number} length
	 */
	text(at, length) {
		return this.#fits(at, length) ? String.fromCharCode(...this.bytes.subarray(at, at + length)) : null;
	}

	/**
	 * @param {number} at
	 * @param {number[]} expected
	 */
	startsWith(at, expected) {
		return this.#fits(at, expected.length) && expected.every((byte, index) => this.bytes[at + index] === byte);
	}

	/**
	 * @param {number} at
	 * @param {number} length
	 */
	#fits(at, length) {
		return at >= 0 && at + length <= this.length;
	}
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * @param {Bytes} view
 * @returns {ImageFormat | null}
 */
function detectFormat(view) {
	if (view.startsWith(0, [0xff, 0xd8, 0xff])) {
		return 'jpeg';
	}
	if (view.startsWith(0, PNG_SIGNATURE)) {
		return 'png';
	}
	const gif = view.text(0, 6);
	if (gif === 'GIF87a' || gif === 'GIF89a') {
		return 'gif';
	}
	if (view.text(0, 4) === 'RIFF' && view.text(8, 4) === 'WEBP') {
		return 'webp';
	}
	if (view.text(4, 4) === 'ftyp' && avifBrands(view)) {
		return 'avif';
	}
	return null;
}

/** @type {Record<ImageFormat, (view: Bytes) => { width: number, height: number } | null>} */
const SIZE_READERS = {
	jpeg: jpegSize,
	png: (view) => (view.text(12, 4) === 'IHDR' ? sizeOf(view.u32be(16), view.u32be(20)) : null),
	gif: (view) => sizeOf(view.u16le(6), view.u16le(8)),
	webp: webpSize,
	avif: avifSize,
};

/**
 * @param {number | null} width
 * @param {number | null} height
 */
function sizeOf(width, height) {
	return width === null || height === null ? null : { width, height };
}

/**
 * Walks the segments to the first frame header (SOF), which holds the size.
 * @param {Bytes} view
 */
function jpegSize(view) {
	let at = 2;
	for (let segment = 0; segment < MAX_SEGMENTS; segment++) {
		if (view.u8(at) !== 0xff) {
			return null;
		}
		// Any number of 0xFF bytes may pad a marker.
		while (view.u8(at + 1) === 0xff) {
			at++;
		}
		const marker = view.u8(at + 1);
		if (marker === null || marker === 0xd9 || marker === 0xda) {
			return null;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		const length = view.u16be(at + 2);
		if (length === null || length < 2) {
			return null;
		}
		// C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding) share the SOF range but aren't frames.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return sizeOf(view.u16be(at + 7), view.u16be(at + 5));
		}
		at += 2 + length;
	}
	return null;
}

/** @param {Bytes} view */
function webpSize(view) {
	const chunk = view.text(12, 4);
	if (chunk === 'VP8 ') {
		if (!view.startsWith(23, [0x9d, 0x01, 0x2a])) {
			return null;
		}
		const width = view.u16le(26);
		const height = view.u16le(28);
		return width === null || height === null ? null : { width: width & 0x3fff, height: height & 0x3fff };
	}
	if (chunk === 'VP8L') {
		const bits = view.u8(20) === 0x2f ? view.u32le(21) : null;
		return bits === null ? null : { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === 'VP8X') {
		const width = view.u24le(24);
		const height = view.u24le(27);
		return width === null || height === null ? null : { width: width + 1, height: height + 1 };
	}
	return null;
}

/**
 * Whether the `ftyp` box names AVIF as its major or a compatible brand.
 * @param {Bytes} view
 */
function avifBrands(view) {
	const size = view.u32be(0);
	if (size === null || size < 16) {
		return false;
	}
	const brands = [view.text(8, 4)];
	for (let at = 16; at + 4 <= Math.min(size, view.length); at += 4) {
		brands.push(view.text(at, 4));
	}
	return brands.includes('avif') || brands.includes('avis');
}

/**
 * The largest `ispe` (image spatial extents) property in `meta` → `iprp` → `ipco`. The largest, rather than the
 * primary item's, so a small thumbnail can't hide a huge image from the size limit.
 * @param {Bytes} view
 */
function avifSize(view) {
	const budget = { boxes: MAX_BOXES };
	const meta = findBox(view, 0, view.length, 'meta', budget);
	// `meta` is a full box: four bytes of version and flags come before its children.
	const iprp = meta && findBox(view, meta.content + 4, meta.end, 'iprp', budget);
	const ipco = iprp && findBox(view, iprp.content, iprp.end, 'ipco', budget);
	if (!ipco) {
		return null;
	}
	/** @type {{ width: number, height: number } | null} */
	let largest = null;
	for (const box of boxes(view, ipco.content, ipco.end, budget)) {
		if (box.type === 'ispe') {
			const size = sizeOf(view.u32be(box.content + 4), view.u32be(box.content + 8));
			if (size === null) {
				return null;
			}
			if (largest === null || size.width * size.height > largest.width * largest.height) {
				largest = size;
			}
		}
	}
	return largest;
}

/**
 * @param {Bytes} view
 * @param {number} start
 * @param {number} end
 * @param {string} type
 * @param {{ boxes: number }} budget
 */
function findBox(view, start, end, type, budget) {
	for (const box of boxes(view, start, end, budget)) {
		if (box.type === type) {
			return box;
		}
	}
	return null;
}

/**
 * The ISO media boxes between two offsets, stopping at the first one that doesn't fit or when the budget runs out.
 * @param {Bytes} view
 * @param {number} start
 * @param {number} end
 * @param {{ boxes: number }} budget shared by every walk of one file
 * @returns {Generator<{ type: string, content: number, end: number }>}
 */
function* boxes(view, start, end, budget) {
	let at = start;
	while (at + 8 <= end && budget.boxes > 0) {
		budget.boxes--;
		const size32 = view.u32be(at);
		const type = view.text(at + 4, 4);
		if (size32 === null || type === null) {
			return;
		}
		let header = 8;
		let size = size32;
		if (size32 === 1) {
			const high = view.u32be(at + 8);
			const low = view.u32be(at + 12);
			if (high === null || low === null) {
				return;
			}
			header = 16;
			size = high * 2 ** 32 + low;
		} else if (size32 === 0) {
			size = end - at;
		}
		if (size < header) {
			return;
		}
		const boxEnd = Math.min(at + size, end);
		yield { type, content: at + header, end: boxEnd };
		at += size;
	}
}
