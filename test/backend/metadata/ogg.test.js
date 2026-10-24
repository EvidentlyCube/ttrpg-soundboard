import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BufferReader } from '../../../src/metadata/binary-reader.js';
import { readOggTitle } from '../../../src/metadata/ogg.js';
import { buildOgg, buildOggHeaderPackets, buildOggPages } from '../../helpers/tag-builders.js';

/** @param {Buffer} bytes */
function readTitleOf(bytes) {
	return readOggTitle(new BufferReader(bytes));
}

describe('readOggTitle', () => {
	it('reads TITLE from Vorbis comments', async () => {
		const ogg = buildOgg({ codec: 'vorbis', comments: ['ARTIST=Someone', 'TITLE=Vorbis Song'] });
		assert.equal(await readTitleOf(ogg), 'Vorbis Song');
	});

	it('reads TITLE from Opus tags', async () => {
		const ogg = buildOgg({ codec: 'opus', comments: ['TITLE=Opus Song'] });
		assert.equal(await readTitleOf(ogg), 'Opus Song');
	});

	it('matches the key case-insensitively and decodes UTF-8', async () => {
		const ogg = buildOgg({ comments: ['title=Zażółć ♪'] });
		assert.equal(await readTitleOf(ogg), 'Zażółć ♪');
	});

	it('uses the first non-empty TITLE', async () => {
		const ogg = buildOgg({ comments: ['TITLE=', 'TITLE=Second', 'TITLE=Third'] });
		assert.equal(await readTitleOf(ogg), 'Second');
	});

	it('keeps "=" inside the value', async () => {
		const ogg = buildOgg({ comments: ['TITLE=a=b'] });
		assert.equal(await readTitleOf(ogg), 'a=b');
	});

	it('does not match keys that only start with TITLE', async () => {
		const ogg = buildOgg({ comments: ['TITLESORT=Wrong'] });
		assert.equal(await readTitleOf(ogg), null);
	});

	it('returns null without a TITLE comment', async () => {
		const ogg = buildOgg({ comments: ['ARTIST=Someone'] });
		assert.equal(await readTitleOf(ogg), null);
	});

	it('reassembles a comment packet spanning several pages', async () => {
		const ogg = buildOgg({ comments: ['X=' + 'x'.repeat(3000), 'TITLE=Spanning'], maxSegmentsPerPage: 3 });
		assert.equal(await readTitleOf(ogg), 'Spanning');
	});

	it('handles a packet whose length is a multiple of 255', async () => {
		const prefixLength = 7 + 4 + 'v'.length + 4 + 4;
		const comment = 'TITLE=' + 'm'.repeat(510 - prefixLength - 1 - 'TITLE='.length);
		const ogg = buildOgg({ comments: [comment], vendor: 'v', maxSegmentsPerPage: 1 });
		assert.equal(await readTitleOf(ogg), comment.slice('TITLE='.length));
	});

	it('ignores pages of other multiplexed streams', async () => {
		const onePacketPerPage = { maxSegmentsPerPage: 1 };
		const main = buildOggPages(buildOggHeaderPackets({ comments: ['TITLE=Main'] }), { serial: 1, ...onePacketPerPage });
		const other = buildOggPages(buildOggHeaderPackets({ comments: ['TITLE=Other'] }), { serial: 2, ...onePacketPerPage });
		const interleaved = Buffer.concat([main[0], other[0], ...main.slice(1)]);
		assert.equal(await readTitleOf(interleaved), 'Main');
	});

	it('finds a title that comes before oversized comments', async () => {
		const ogg = buildOgg({ comments: ['TITLE=Early', 'METADATA_BLOCK_PICTURE=' + 'p'.repeat(2 * 1024 * 1024)] });
		assert.equal(await readTitleOf(ogg), 'Early');
	});

	it('stops reading after 1 MB', async () => {
		const ogg = buildOgg({ comments: ['METADATA_BLOCK_PICTURE=' + 'p'.repeat(2 * 1024 * 1024), 'TITLE=Late'] });
		assert.equal(await readTitleOf(ogg), null);
	});

	describe('malformed data', () => {
		it('returns null for non-Ogg data', async () => {
			assert.equal(await readTitleOf(Buffer.from('ID3 not an ogg file at all, just text')), null);
		});

		it('returns null for an empty file', async () => {
			assert.equal(await readTitleOf(Buffer.alloc(0)), null);
		});

		it('returns null for codecs other than Vorbis and Opus', async () => {
			const [, comments, audio] = buildOggHeaderPackets({ comments: ['TITLE=Flac'] });
			const flacIdentification = Buffer.from('\x7fFLAC whatever', 'latin1');
			assert.equal(await readTitleOf(Buffer.concat(buildOggPages([flacIdentification, comments, audio]))), null);
		});

		it('returns null when the comment header does not match the codec', async () => {
			const [vorbisIdentification] = buildOggHeaderPackets({ codec: 'vorbis' });
			const [, opusComments] = buildOggHeaderPackets({ codec: 'opus', comments: ['TITLE=Mismatch'] });
			assert.equal(await readTitleOf(Buffer.concat(buildOggPages([vorbisIdentification, opusComments]))), null);
		});

		it('returns null for a truncated comment header', async () => {
			const ogg = buildOgg({ comments: ['ARTIST=' + 'a'.repeat(400), 'TITLE=Cut'] });
			assert.equal(await readTitleOf(ogg.subarray(0, 300)), null);
		});

		it('returns null when a comment claims more bytes than the packet has', async () => {
			const ogg = buildOgg({ comments: ['TITLE=Liar'] });
			const lengthOffset = ogg.indexOf('TITLE=Liar') - 4;
			ogg.writeUInt32LE(9999, lengthOffset);
			assert.equal(await readTitleOf(ogg), null);
		});

		it('never throws on random bytes after an Ogg capture pattern', async () => {
			let seed = 7;
			const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256;
			for (let i = 0; i < 500; i++) {
				const bytes = Buffer.from(Array.from({ length: 27 + (i % 300) }, random));
				bytes.write('OggS', 0, 'latin1');
				bytes[4] = 0;
				await readTitleOf(bytes);
			}
		});
	});
});
