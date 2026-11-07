/**
 * Minimal image headers for tests: just enough bytes for `inspectImage` to find the format and size. None of them
 * decodes into a picture.
 */

/**
 * @param {number} width
 * @param {number} height
 */
export function pngBytes(width, height) {
	const bytes = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
	bytes.writeUInt32BE(13, 8);
	bytes.write('IHDR', 12, 'latin1');
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {'87a' | '89a'} [version]
 */
export function gifBytes(width, height, version = '89a') {
	const bytes = Buffer.alloc(13);
	bytes.write(`GIF${version}`, 0, 'latin1');
	bytes.writeUInt16LE(width, 6);
	bytes.writeUInt16LE(height, 8);
	return bytes;
}

/**
 * A JPEG with an APP0 segment and, optionally, a large EXIF-like APP1 before its frame header.
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {number} [options.exifBytes] the size of an APP1 segment's content before the frame header
 * @param {number} [options.sof] the frame marker
 */
export function jpegBytes(width, height, { exifBytes = 0, sof = 0xc0 } = {}) {
	const parts = [Buffer.from([0xff, 0xd8])];
	parts.push(segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')));
	if (exifBytes > 0) {
		parts.push(segment(0xe1, Buffer.alloc(exifBytes)));
	}
	// A Huffman table segment shares the frame markers' range and must be skipped.
	parts.push(segment(0xc4, Buffer.alloc(4)));
	const frame = Buffer.alloc(6);
	frame[0] = 8;
	frame.writeUInt16BE(height, 1);
	frame.writeUInt16BE(width, 3);
	frame[5] = 3;
	parts.push(segment(sof, frame));
	return Buffer.concat(parts);
}

/**
 * @param {number} marker
 * @param {Buffer} content
 */
function segment(marker, content) {
	const header = Buffer.from([0xff, marker, 0, 0]);
	header.writeUInt16BE(content.length + 2, 2);
	return Buffer.concat([header, content]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {'VP8 ' | 'VP8L' | 'VP8X'} [chunk]
 */
export function webpBytes(width, height, chunk = 'VP8X') {
	const bytes = Buffer.alloc(30);
	bytes.write('RIFF', 0, 'latin1');
	bytes.writeUInt32LE(22, 4);
	bytes.write('WEBP', 8, 'latin1');
	bytes.write(chunk, 12, 'latin1');
	if (chunk === 'VP8 ') {
		bytes[23] = 0x9d;
		bytes[24] = 0x01;
		bytes[25] = 0x2a;
		bytes.writeUInt16LE(width, 26);
		bytes.writeUInt16LE(height, 28);
	} else if (chunk === 'VP8L') {
		bytes[20] = 0x2f;
		bytes.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
	} else {
		bytes.writeUIntLE(width - 1, 24, 3);
		bytes.writeUIntLE(height - 1, 27, 3);
	}
	return bytes;
}

/**
 * An AVIF with `ftyp` and `meta` → `iprp` → `ipco` holding one `ispe` per size.
 * @param {{ width: number, height: number }[]} sizes
 * @param {object} [options]
 * @param {string} [options.major] the major brand
 * @param {string[]} [options.compatible] the compatible brands
 */
export function avifBytes(sizes, { major = 'avif', compatible = ['mif1', 'miaf'] } = {}) {
	const ftyp = box('ftyp', Buffer.concat([
		Buffer.from(major, 'latin1'),
		Buffer.alloc(4),
		...compatible.map((brand) => Buffer.from(brand, 'latin1')),
	]));
	const ispes = sizes.map(({ width, height }) => {
		const content = Buffer.alloc(12);
		content.writeUInt32BE(width, 4);
		content.writeUInt32BE(height, 8);
		return box('ispe', content);
	});
	const ipco = box('ipco', Buffer.concat(ispes));
	const iprp = box('iprp', ipco);
	const meta = box('meta', Buffer.concat([Buffer.alloc(4), box('hdlr', Buffer.alloc(8)), iprp]));
	return Buffer.concat([ftyp, meta]);
}

/**
 * @param {string} type
 * @param {Buffer} content
 */
export function box(type, content) {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(content.length + 8, 0);
	header.write(type, 4, 'latin1');
	return Buffer.concat([header, content]);
}
