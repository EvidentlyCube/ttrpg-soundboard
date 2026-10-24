import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BufferReader } from '../../../src/metadata/binary-reader.js';
import { readId3Title } from '../../../src/metadata/id3.js';
import { buildId3v1, buildId3v2, syncsafe, textFrame, unsynchronize } from '../../helpers/tag-builders.js';

const AUDIO = Buffer.alloc(1000, 0x55);

/** @param {...Buffer} parts */
function readTitleOf(...parts) {
	return readId3Title(new BufferReader(Buffer.concat(parts)));
}

describe('readId3Title', () => {
	describe('ID3v2 versions', () => {
		it('reads TT2 from ID3v2.2', async () => {
			const tag = buildId3v2({ version: 2, frames: [textFrame('TAL', 'Album'), textFrame('TT2', 'Old Title')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'Old Title');
		});

		it('reads TIT2 from ID3v2.3', async () => {
			const tag = buildId3v2({ version: 3, frames: [textFrame('TPE1', 'Artist'), textFrame('TIT2', 'Title 3')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'Title 3');
		});

		it('reads TIT2 from ID3v2.4', async () => {
			const tag = buildId3v2({ version: 4, frames: [textFrame('TIT2', 'Title 4')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'Title 4');
		});

		it('uses the syncsafe frame size in ID3v2.4 when skipping frames', async () => {
			const big = { id: 'PRIV', body: Buffer.alloc(200, 0x01) };
			const tag = buildId3v2({ version: 4, frames: [big, textFrame('TIT2', 'After Big Frame')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'After Big Frame');
		});

		it('skips large frames such as cover art', async () => {
			const cover = { id: 'APIC', body: Buffer.alloc(3 * 1024 * 1024, 0xff) };
			const tag = buildId3v2({ version: 3, frames: [cover, textFrame('TIT2', 'After Cover')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'After Cover');
		});

		it('ignores unsupported major versions', async () => {
			const tag = buildId3v2({ version: 4, frames: [textFrame('TIT2', 'Future')] });
			tag[3] = 5;
			assert.equal(await readTitleOf(tag, AUDIO), null);
		});
	});

	describe('text encodings', () => {
		/** @type {[import('../../helpers/tag-builders.js').Id3TextEncoding, string][]} */
		const cases = [
			[0, 'Café Ümlaut'],
			[1, 'Zażółć gęślą jaźń'],
			[2, 'Ünïcödé BE ♪'],
			[3, 'UTF-8 ♫ 日本語'],
		];
		for (const [encoding, text] of cases) {
			it(`decodes encoding ${encoding}`, async () => {
				const tag = buildId3v2({ version: 4, frames: [textFrame('TIT2', text, encoding)] });
				assert.equal(await readTitleOf(tag, AUDIO), text);
			});
		}

		it('decodes big-endian UTF-16 marked by its BOM', async () => {
			const body = Buffer.concat([Buffer.from([1, 0xfe, 0xff]), Buffer.from('Big End', 'utf16le').swap16()]);
			const tag = buildId3v2({ version: 3, frames: [{ id: 'TIT2', body }] });
			assert.equal(await readTitleOf(tag, AUDIO), 'Big End');
		});

		it('takes the first of several null-separated values', async () => {
			const tag = buildId3v2({ version: 4, frames: [textFrame('TIT2', 'First\0Second', 3)] });
			assert.equal(await readTitleOf(tag, AUDIO), 'First');
		});

		it('trims terminators and whitespace', async () => {
			const tag = buildId3v2({ version: 3, frames: [textFrame('TIT2', '  Padded  \0\0')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'Padded');
		});

		it('treats an empty title as missing', async () => {
			const tag = buildId3v2({ version: 3, frames: [textFrame('TIT2', ' \0')] });
			assert.equal(await readTitleOf(tag, AUDIO), null);
		});

		it('treats an unknown encoding as missing', async () => {
			const tag = buildId3v2({ version: 4, frames: [{ id: 'TIT2', body: Buffer.from([9, 65, 66]) }] });
			assert.equal(await readTitleOf(tag, AUDIO), null);
		});
	});

	describe('headers and flags', () => {
		it('skips an ID3v2.3 extended header', async () => {
			const tag = buildId3v2({ version: 3, extendedHeader: true, frames: [textFrame('TIT2', 'Extended 3')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'Extended 3');
		});

		it('skips an ID3v2.4 extended header', async () => {
			const tag = buildId3v2({ version: 4, extendedHeader: true, frames: [textFrame('TIT2', 'Extended 4')] });
			assert.equal(await readTitleOf(tag, AUDIO), 'Extended 4');
		});

		it('reverses tag-wide unsynchronization in ID3v2.3', async () => {
			const tricky = { id: 'PRIV', body: Buffer.from([0xff, 0xe0, 0xff, 0x00, 0xff]) };
			const tag = buildId3v2({
				version: 3,
				unsynchronized: true,
				frames: [tricky, textFrame('TIT2', 'ÿàÿ')],
			});
			assert.equal(await readTitleOf(tag, AUDIO), 'ÿàÿ');
		});

		it('reverses frame-level unsynchronization and skips the data length indicator in ID3v2.4', async () => {
			const raw = textFrame('TIT2', 'ÿàSync').body;
			const body = Buffer.concat([syncsafe(raw.length), unsynchronize(raw)]);
			const tag = buildId3v2({ version: 4, frames: [{ id: 'TIT2', body, flags: [0, 0x03] }] });
			assert.equal(await readTitleOf(tag, AUDIO), 'ÿàSync');
		});

		it('skips the group identifier byte', async () => {
			const v3 = buildId3v2({ version: 3, frames: [{ id: 'TIT2', body: Buffer.concat([Buffer.from([7]), textFrame('TIT2', 'Grouped 3').body]), flags: [0, 0x20] }] });
			const v4 = buildId3v2({ version: 4, frames: [{ id: 'TIT2', body: Buffer.concat([Buffer.from([7]), textFrame('TIT2', 'Grouped 4').body]), flags: [0, 0x40] }] });
			assert.equal(await readTitleOf(v3, AUDIO), 'Grouped 3');
			assert.equal(await readTitleOf(v4, AUDIO), 'Grouped 4');
		});

		it('gives up on compressed or encrypted title frames', async () => {
			const compressed = buildId3v2({ version: 3, frames: [{ ...textFrame('TIT2', 'Hidden'), flags: [0, 0x80] }] });
			const encrypted = buildId3v2({ version: 4, frames: [{ ...textFrame('TIT2', 'Hidden'), flags: [0, 0x04] }] });
			assert.equal(await readTitleOf(compressed, AUDIO), null);
			assert.equal(await readTitleOf(encrypted, AUDIO), null);
		});

		it('stops at padding', async () => {
			const tag = buildId3v2({ version: 4, frames: [textFrame('TALB', 'Album')], padding: 512 });
			assert.equal(await readTitleOf(tag, AUDIO), null);
		});
	});

	describe('ID3v1 fallback', () => {
		it('reads an ID3v1 title when there is no ID3v2 tag', async () => {
			assert.equal(await readTitleOf(AUDIO, buildId3v1('Old School')), 'Old School');
		});

		it('reads an ID3v1 title when the ID3v2 tag has none', async () => {
			const tag = buildId3v2({ version: 3, frames: [textFrame('TALB', 'Album')] });
			assert.equal(await readTitleOf(tag, AUDIO, buildId3v1('Fallback')), 'Fallback');
		});

		it('prefers the ID3v2 title', async () => {
			const tag = buildId3v2({ version: 3, frames: [textFrame('TIT2', 'Modern')] });
			assert.equal(await readTitleOf(tag, AUDIO, buildId3v1('Old')), 'Modern');
		});

		it('uses the full 30 characters', async () => {
			const title = 'A'.repeat(30);
			assert.equal(await readTitleOf(AUDIO, buildId3v1(title)), title);
		});
	});

	describe('malformed data', () => {
		it('returns null when there are no tags', async () => {
			assert.equal(await readTitleOf(AUDIO), null);
		});

		it('returns null for an empty file', async () => {
			assert.equal(await readTitleOf(Buffer.alloc(0)), null);
		});

		it('returns null when the tag claims more bytes than the file has', async () => {
			const tag = buildId3v2({ version: 3, frames: [textFrame('TIT2', 'Cut Off')] });
			assert.equal(await readTitleOf(tag.subarray(0, tag.length - 4)), null);
		});

		it('returns null when a frame claims more bytes than the tag has', async () => {
			const tag = buildId3v2({ version: 3, frames: [textFrame('TIT2', 'Liar')] });
			tag.writeUInt32BE(5000, 14);
			assert.equal(await readTitleOf(tag, AUDIO), null);
		});

		it('never throws on random bytes after an ID3 header', async () => {
			let seed = 42;
			const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256;
			for (let i = 0; i < 500; i++) {
				const bytes = Buffer.from(Array.from({ length: 10 + (i % 200) }, random));
				bytes.write('ID3', 0, 'latin1');
				bytes[3] = 2 + (i % 3);
				await readTitleOf(bytes);
			}
		});
	});
});
