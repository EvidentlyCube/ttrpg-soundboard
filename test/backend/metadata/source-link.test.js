import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BufferReader } from '../../../src/metadata/binary-reader.js';
import { readId3SourceLink } from '../../../src/metadata/id3.js';
import { readSourceLink } from '../../../src/metadata/index.js';
import { readOggSourceLink } from '../../../src/metadata/ogg.js';
import { buildId3v2, buildOgg, encodeId3Text, textFrame } from '../../helpers/tag-builders.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

const AUDIO = Buffer.alloc(1000, 0x55);
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** @param {import('../../helpers/tag-builders.js').Id3Frame[]} frames */
function linkOf(frames, version = /** @type {2 | 3 | 4} */ (4)) {
	return readId3SourceLink(new BufferReader(Buffer.concat([buildId3v2({ version, frames }), AUDIO])));
}

/**
 * A user link frame: an encoding byte, a description in that encoding, then the URL in ISO-8859-1.
 * @param {string} url
 * @param {import('../../helpers/tag-builders.js').Id3TextEncoding} [encoding]
 */
function userLink(url, encoding = 0) {
	const terminator = encoding === 1 || encoding === 2 ? Buffer.alloc(2) : Buffer.alloc(1);
	return { id: 'WXXX', body: Buffer.concat([encodeId3Text('Page', encoding), terminator, Buffer.from(url, 'latin1')]) };
}

/**
 * A comment frame: an encoding byte, a language, a short description, then the text.
 * @param {string} text
 */
function comment(text) {
	const body = encodeId3Text(`\0${text}`, 3);
	return { id: 'COMM', body: Buffer.concat([body.subarray(0, 1), Buffer.from('eng'), body.subarray(1)]) };
}

describe('readId3SourceLink', () => {
	it('reads a user link frame, whatever the description\'s encoding', async () => {
		assert.equal(await linkOf([userLink(VIDEO)]), VIDEO);
		assert.equal(await linkOf([userLink(VIDEO, 1)]), VIDEO);
	});

	it('reads the "purl" text frame yt-dlp writes, and no other', async () => {
		assert.equal(await linkOf([textFrame('TXXX', `purl\0${VIDEO}`, 1)]), VIDEO);
		assert.equal(await linkOf([textFrame('TXXX', `website\0${VIDEO}`)]), null);
	});

	it('reads the official source link and a link inside a comment', async () => {
		assert.equal(await linkOf([{ id: 'WOAS', body: Buffer.from(VIDEO, 'latin1') }]), VIDEO);
		assert.equal(await linkOf([comment(`Downloaded from ${VIDEO} yesterday`)]), VIDEO);
	});

	it('prefers a user link over a comment, wherever they are in the tag', async () => {
		assert.equal(await linkOf([comment('https://example.com/other'), userLink(VIDEO)]), VIDEO);
	});

	it('reads ID3v2.2 frames by their short ids', async () => {
		assert.equal(await linkOf([{ id: 'WXX', body: userLink(VIDEO).body }], 2), VIDEO);
	});

	it('finds nothing without a link, and keeps reading titles as before', async () => {
		assert.equal(await linkOf([textFrame('TIT2', 'Title'), comment('no link here')]), null);
		assert.equal(await readId3SourceLink(new BufferReader(AUDIO)), null);
	});
});

describe('readOggSourceLink', () => {
	/** @param {string[]} comments */
	const oggLinkOf = (comments) => readOggSourceLink(new BufferReader(buildOgg({ comments })));

	it('reads PURL, then COMMENT, then DESCRIPTION, with keys in any case', async () => {
		assert.equal(await oggLinkOf([`purl=${VIDEO}`]), VIDEO);
		assert.equal(await oggLinkOf(['DESCRIPTION=https://example.com/b', 'COMMENT=see https://example.com/a here']), 'https://example.com/a');
		assert.equal(await oggLinkOf(['DESCRIPTION=https://example.com/b', `PURL=${VIDEO}`]), VIDEO);
	});

	it('finds nothing in other comments', async () => {
		assert.equal(await oggLinkOf([`TITLE=${VIDEO}`, 'COMMENT=no link']), null);
	});
});

describe('readSourceLink', () => {
	/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
	let tree;
	before(async () => {
		tree = await createTmpTree({
			'a.mp3': Buffer.concat([buildId3v2({ frames: [userLink(VIDEO)] }), AUDIO]),
			'b.ogg': buildOgg({ comments: [`PURL=${VIDEO}`] }),
			'c.wav': Buffer.concat([buildId3v2({ frames: [userLink(VIDEO)] }), AUDIO]),
		});
	});
	after(() => tree.remove());

	it('picks the reader by extension', async () => {
		assert.equal(await readSourceLink(join(tree.root, 'a.mp3')), VIDEO);
		assert.equal(await readSourceLink(join(tree.root, 'b.ogg')), VIDEO);
		assert.equal(await readSourceLink(join(tree.root, 'c.wav')), null);
	});
});
