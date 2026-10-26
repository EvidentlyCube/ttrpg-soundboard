import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BufferReader } from '../../../src/metadata/binary-reader.js';
import { readDuration } from '../../../src/metadata/index.js';
import { readMpegDuration } from '../../../src/metadata/mpeg.js';
import { readOggDuration } from '../../../src/metadata/ogg.js';
import {
	buildId3v1,
	buildId3v2,
	buildMp3Frame,
	buildOggHeaderPackets,
	buildOggPage,
	oggIdentificationPacket,
	textFrame,
	vbriPayload,
	xingPayload,
} from '../../helpers/tag-builders.js';

const FIXTURE = join(import.meta.dirname, '..', '..', '..', 'test_fixtures', 'example_soundboard');

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} [tolerance]
 */
function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

/** @param {Buffer} bytes */
const mpeg = (bytes) => readMpegDuration(new BufferReader(bytes));
/** @param {Buffer} bytes */
const ogg = (bytes) => readOggDuration(new BufferReader(bytes));

/** @param {number} count */
const cbrFrames = (count) => Buffer.concat(Array.from({ length: count }, () => buildMp3Frame()));

describe('readMpegDuration', () => {
	it('estimates constant-bitrate files from their size and bitrate', async () => {
		const frames = cbrFrames(100);
		near(/** @type {number} */ (await mpeg(frames)), (frames.length * 8) / 128_000);
	});

	it('ignores ID3v2 and ID3v1 tags around the audio', async () => {
		const frames = cbrFrames(100);
		const tagged = Buffer.concat([buildId3v2({ frames: [textFrame('TIT2', 'Title')], padding: 500 }), frames, buildId3v1('Title')]);
		near(/** @type {number} */ (await mpeg(tagged)), (frames.length * 8) / 128_000);
	});

	it('counts frames from a Xing header', async () => {
		const bytes = Buffer.concat([buildMp3Frame({ payload: xingPayload(1000) }), cbrFrames(5)]);
		near(/** @type {number} */ (await mpeg(bytes)), (1000 * 1152) / 44100);
	});

	it('counts frames from an Info header, as LAME writes for constant bitrate', async () => {
		const bytes = Buffer.concat([buildMp3Frame({ payload: xingPayload(400, { tag: 'Info' }) }), cbrFrames(5)]);
		near(/** @type {number} */ (await mpeg(bytes)), (400 * 1152) / 44100);
	});

	it('finds the Xing header after mono and MPEG-2 side information', async () => {
		const mono = Buffer.concat([buildMp3Frame({ mono: true, payload: xingPayload(300, { mono: true }) }), buildMp3Frame({ mono: true })]);
		near(/** @type {number} */ (await mpeg(mono)), (300 * 1152) / 44100);

		const mpeg2 = Buffer.concat([
			buildMp3Frame({ version: 2, bitrate: 64, payload: xingPayload(500, { version: 2 }) }),
			buildMp3Frame({ version: 2, bitrate: 64 }),
		]);
		near(/** @type {number} */ (await mpeg(mpeg2)), (500 * 576) / 22050);
	});

	it('counts frames from a VBRI header', async () => {
		const bytes = Buffer.concat([buildMp3Frame({ payload: vbriPayload(200) }), cbrFrames(5)]);
		near(/** @type {number} */ (await mpeg(bytes)), (200 * 1152) / 44100);
	});

	it('skips bytes that only look like a frame header', async () => {
		const fake = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03]);
		const frames = cbrFrames(50);
		near(/** @type {number} */ (await mpeg(Buffer.concat([fake, frames]))), (frames.length * 8) / 128_000);
	});

	it('returns null without frames, and never throws on truncated or random data', async () => {
		assert.equal(await mpeg(Buffer.alloc(0)), null);
		assert.equal(await mpeg(Buffer.alloc(5000, 0x41)), null);
		assert.equal(await mpeg(buildId3v2({ frames: [textFrame('TIT2', 'Only a tag')] })), null);
		const frame = buildMp3Frame({ payload: xingPayload(1000) });
		for (let length = 0; length < frame.length; length += 7) {
			await mpeg(frame.subarray(0, length));
		}
		for (let seed = 1; seed <= 50; seed++) {
			await mpeg(Buffer.from(Array.from({ length: 2000 }, (_, i) => (seed * 7919 + i * 104729) % 256)));
		}
	});
});

/**
 * @param {Buffer} identification
 * @param {bigint[]} granules one audio page per granule position, after the header pages
 * @param {{ serial?: number }} [options]
 */
function oggFile(identification, granules, { serial = 1 } = {}) {
	const [, comments] = buildOggHeaderPackets({});
	const pages = [
		buildOggPage(identification, { granule: 0n, serial, sequence: 0 }),
		buildOggPage(comments, { granule: 0n, serial, sequence: 1 }),
		...granules.map((granule, i) => buildOggPage(Buffer.alloc(400, 0x33), { granule, serial, sequence: i + 2, last: i === granules.length - 1 })),
	];
	return Buffer.concat(pages);
}

describe('readOggDuration', () => {
	it('divides the last granule position by the Vorbis sample rate', async () => {
		near(/** @type {number} */ (await ogg(oggFile(oggIdentificationPacket({ sampleRate: 44100 }), [44100n, 441000n]))), 10);
		near(/** @type {number} */ (await ogg(oggFile(oggIdentificationPacket({ sampleRate: 48000 }), [120000n]))), 2.5);
	});

	it('uses 48 kHz minus the pre-skip for Opus', async () => {
		near(/** @type {number} */ (await ogg(oggFile(oggIdentificationPacket({ codec: 'opus', preSkip: 312 }), [48000n * 5n + 312n]))), 5);
	});

	it('skips a last page where no packet ends', async () => {
		near(/** @type {number} */ (await ogg(oggFile(oggIdentificationPacket(), [88200n, -1n]))), 2);
	});

	it('only reads pages of the first stream', async () => {
		const audio = oggFile(oggIdentificationPacket(), [44100n * 3n]);
		const other = buildOggPage(Buffer.alloc(100), { granule: 44100n * 99n, serial: 2, sequence: 5 });
		near(/** @type {number} */ (await ogg(Buffer.concat([audio, other]))), 3);
	});

	it('finds the last page behind a large one', async () => {
		const identification = oggIdentificationPacket();
		const [, comments] = buildOggHeaderPackets({});
		const bytes = Buffer.concat([
			buildOggPage(identification, { granule: 0n, sequence: 0 }),
			buildOggPage(comments, { granule: 0n, sequence: 1 }),
			buildOggPage(Buffer.alloc(255 * 250, 0x44), { granule: 44100n, sequence: 2 }),
			buildOggPage(Buffer.alloc(255 * 250, 0x44), { granule: 44100n * 7n, sequence: 3, last: true }),
		]);
		near(/** @type {number} */ (await ogg(bytes)), 7);
	});

	it('returns null for other data, and never throws on truncated or random data', async () => {
		assert.equal(await ogg(Buffer.alloc(0)), null);
		assert.equal(await ogg(Buffer.from('not an ogg file at all')), null);
		const flac = Buffer.from('\x7fFLAC', 'latin1');
		assert.equal(await ogg(oggFile(Buffer.concat([flac, Buffer.alloc(30)]), [44100n])), null);
		assert.equal(await ogg(oggFile(oggIdentificationPacket({ sampleRate: 0 }), [44100n])), null);
		const bytes = oggFile(oggIdentificationPacket(), [44100n]);
		for (let length = 0; length < bytes.length; length += 11) {
			await ogg(bytes.subarray(0, length));
		}
		for (let seed = 1; seed <= 50; seed++) {
			await ogg(Buffer.from(Array.from({ length: 3000 }, (_, i) => (seed * 6007 + i * 7727) % 256)));
		}
	});
});

describe('readDuration', () => {
	it('reads every file in the example fixture to within 0.1 s of ffprobe', async () => {
		/** @type {[string, number][]} */
		const expected = [
			['Sound MP3 no title tag.mp3', 6.006],
			['Sound MP3 with title tag.mp3', 1.646],
			['Sound OGG no title tag.ogg', 4.947],
			['Sound OGG with title tag.ogg', 2.384],
			['Music Mix/Song 1 MP3 with title tag.mp3', 30.804],
			['Music MP3/Song 2 MP3 with title tag.mp3', 30.080],
			['Music Mix/Song 2 OGG with title tag.ogg', 30.225],
			['Music Ogg/Song 1 OGG with title tag.ogg', 30.250],
		];
		for (const [file, seconds] of expected) {
			const duration = await readDuration(join(FIXTURE, file));
			assert.ok(duration !== null && Math.abs(duration - seconds) <= 0.1, `${file}: ${duration}, expected about ${seconds}`);
		}
	});

	it('returns null for unsupported extensions', async () => {
		assert.equal(await readDuration(join(FIXTURE, 'Music MP3.json')), null);
	});
});
