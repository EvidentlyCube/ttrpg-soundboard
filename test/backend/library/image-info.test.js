import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
	checkClaimedFormat,
	checkImageBytes,
	formatOfExtension,
	formatOfPath,
	formatOfType,
	inspectImage,
	inspectImageFile,
	InvalidImageError,
	isLargerThanFullHd,
	MAX_IMAGE_BYTES,
} from '../../../src/library/image-info.js';
import { avifBytes, box, gifBytes, jpegBytes, pngBytes, webpBytes } from '../../helpers/image-bytes.js';

/**
 * @param {() => unknown} action
 * @param {string} code
 */
function assertRefused(action, code) {
	assert.throws(action, (error) => error instanceof InvalidImageError && error.messageCode === code);
}

describe('inspectImage', () => {
	it('reads a PNG', () => {
		assert.deepEqual(inspectImage(pngBytes(640, 480)), { format: 'png', width: 640, height: 480 });
	});

	it('reads both GIF versions', () => {
		assert.deepEqual(inspectImage(gifBytes(320, 200, '87a')), { format: 'gif', width: 320, height: 200 });
		assert.deepEqual(inspectImage(gifBytes(321, 201)), { format: 'gif', width: 321, height: 201 });
	});

	it('reads a JPEG, skipping the segments before its frame header', () => {
		assert.deepEqual(inspectImage(jpegBytes(1024, 768)), { format: 'jpeg', width: 1024, height: 768 });
	});

	it('reads a JPEG whose EXIF block comes before the size', () => {
		assert.deepEqual(inspectImage(jpegBytes(800, 600, { exifBytes: 60_000 })), { format: 'jpeg', width: 800, height: 600 });
	});

	it('reads a progressive JPEG', () => {
		assert.deepEqual(inspectImage(jpegBytes(800, 600, { sof: 0xc2 })), { format: 'jpeg', width: 800, height: 600 });
	});

	it('reads the three kinds of WebP', () => {
		assert.deepEqual(inspectImage(webpBytes(500, 300, 'VP8 ')), { format: 'webp', width: 500, height: 300 });
		assert.deepEqual(inspectImage(webpBytes(500, 300, 'VP8L')), { format: 'webp', width: 500, height: 300 });
		assert.deepEqual(inspectImage(webpBytes(500, 300, 'VP8X')), { format: 'webp', width: 500, height: 300 });
	});

	it('reads an AVIF by its major or a compatible brand', () => {
		assert.deepEqual(inspectImage(avifBytes([{ width: 1200, height: 900 }])), { format: 'avif', width: 1200, height: 900 });
		const compatible = avifBytes([{ width: 10, height: 20 }], { major: 'mif1', compatible: ['avis'] });
		assert.deepEqual(inspectImage(compatible), { format: 'avif', width: 10, height: 20 });
	});

	it("takes an AVIF's largest size, so a thumbnail cannot hide a huge image", () => {
		const bytes = avifBytes([{ width: 64, height: 64 }, { width: 9000, height: 9000 }]);
		assertRefused(() => inspectImage(bytes), 'image.dimensions');
	});

	it('refuses an ISO media file that is not an AVIF', () => {
		assertRefused(() => inspectImage(avifBytes([{ width: 10, height: 10 }], { major: 'isom', compatible: ['mp41'] })), 'image.format');
	});

	it('refuses what is not one of the five formats', () => {
		assertRefused(() => inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image.format');
		assertRefused(() => inspectImage(Buffer.from('BM\0\0\0\0')), 'image.format');
		assertRefused(() => inspectImage(Buffer.alloc(0)), 'image.format');
	});

	it('refuses truncated headers', () => {
		assertRefused(() => inspectImage(pngBytes(10, 10).subarray(0, 20)), 'image.unreadable');
		assertRefused(() => inspectImage(gifBytes(10, 10).subarray(0, 8)), 'image.unreadable');
		assertRefused(() => inspectImage(jpegBytes(10, 10).subarray(0, 30)), 'image.unreadable');
		assertRefused(() => inspectImage(webpBytes(10, 10, 'VP8X').subarray(0, 26)), 'image.unreadable');
		const avif = avifBytes([{ width: 10, height: 10 }]);
		assertRefused(() => inspectImage(avif.subarray(0, avif.length - 6)), 'image.unreadable');
	});

	it('refuses a zero size', () => {
		assertRefused(() => inspectImage(pngBytes(0, 10)), 'image.unreadable');
	});

	it('refuses a JPEG whose segment length is too short to move on', () => {
		const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
		assertRefused(() => inspectImage(bytes), 'image.unreadable');
	});

	it('refuses a JPEG that reaches its image data before a frame header', () => {
		assertRefused(() => inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08])), 'image.unreadable');
	});

	it('stops walking crafted AVIF boxes', () => {
		// Many empty boxes before `meta`: the walk gives up rather than reading them all.
		const ftyp = box('ftyp', Buffer.from('avif\0\0\0\0mif1miaf', 'latin1'));
		const meta = avifBytes([{ width: 10, height: 10 }]).subarray(ftyp.length);
		/** @param {number} count */
		const padded = (count) => Buffer.concat([ftyp, ...Array.from({ length: count }, () => box('free', Buffer.alloc(0))), meta]);
		assert.equal(inspectImage(padded(10)).width, 10);
		assertRefused(() => inspectImage(padded(200)), 'image.unreadable');
		// A box that claims less than its own header.
		const broken = Buffer.from(ftyp);
		const tiny = Buffer.alloc(8);
		tiny.writeUInt32BE(4, 0);
		tiny.write('meta', 4, 'latin1');
		assertRefused(() => inspectImage(Buffer.concat([broken, tiny])), 'image.unreadable');
	});

	it('refuses an image over 8192 px on either side', () => {
		assert.equal(inspectImage(pngBytes(8192, 8192)).width, 8192);
		assertRefused(() => inspectImage(pngBytes(8193, 10)), 'image.dimensions');
		assertRefused(() => inspectImage(pngBytes(10, 8193)), 'image.dimensions');
	});
});

describe('isLargerThanFullHd', () => {
	it('counts portrait and landscape 1080p as 1080p', () => {
		assert.equal(isLargerThanFullHd({ width: 1920, height: 1080 }), false);
		assert.equal(isLargerThanFullHd({ width: 1080, height: 1920 }), false);
	});

	it('is true past 1920 on the longer side or 1080 on the shorter one', () => {
		assert.equal(isLargerThanFullHd({ width: 1921, height: 100 }), true);
		assert.equal(isLargerThanFullHd({ width: 1500, height: 1500 }), true);
	});
});

describe('the format of names and types', () => {
	it('reads extensions in any case, with or without the dot', () => {
		assert.equal(formatOfExtension('JPEG'), 'jpeg');
		assert.equal(formatOfExtension('.jpg'), 'jpeg');
		assert.equal(formatOfExtension('svg'), null);
		assert.equal(formatOfPath('/images/photo.WebP'), 'webp');
		assert.equal(formatOfPath('/images/photo'), null);
	});

	it('reads content types, ignoring parameters', () => {
		assert.equal(formatOfType('image/avif'), 'avif');
		assert.equal(formatOfType('Image/PNG; charset=binary'), 'png');
		assert.equal(formatOfType('image/svg+xml'), null);
	});
});

describe('checkClaimedFormat', () => {
	it('passes a match and names both formats on a mismatch', () => {
		checkClaimedFormat({ format: 'png', width: 1, height: 1 }, 'png');
		assert.throws(
			() => checkClaimedFormat({ format: 'jpeg', width: 1, height: 1 }, 'png'),
			(error) => error instanceof InvalidImageError
				&& error.messageCode === 'image.mismatch'
				&& error.messageParams.claimed === 'PNG'
				&& error.messageParams.actual === 'JPEG',
		);
	});
});

describe('checkImageBytes', () => {
	it('refuses more than 16 MB', () => {
		checkImageBytes(MAX_IMAGE_BYTES);
		assertRefused(() => checkImageBytes(MAX_IMAGE_BYTES + 1), 'image.tooLarge');
	});
});

describe('inspectImageFile', () => {
	/** @type {string} */
	let dir;
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'image-info-'));
	});
	after(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("reads the header and the file's size and date", async () => {
		const path = join(dir, 'a.png');
		const bytes = pngBytes(30, 40);
		await writeFile(path, bytes);
		const info = await inspectImageFile(path);
		assert.equal(info.format, 'png');
		assert.equal(info.width, 30);
		assert.equal(info.size, bytes.length);
		assert.ok(info.modified instanceof Date);
	});

	it('refuses a file over 16 MB without reading its header', async () => {
		const path = join(dir, 'big.png');
		await writeFile(path, Buffer.concat([pngBytes(10, 10), Buffer.alloc(MAX_IMAGE_BYTES)]));
		await assert.rejects(inspectImageFile(path), (error) => error instanceof InvalidImageError && error.messageCode === 'image.tooLarge');
	});
});
