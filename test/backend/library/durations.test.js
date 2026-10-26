import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureIfNeeded } from '../../../src/library/durations.js';

const MODIFIED = '2026-10-24T16:41:00.000Z';
const HASH = 'a'.repeat(40);

/**
 * @param {Partial<{ size: number, modified: string }>} [file]
 * @returns {import('../../../src/library/scanner.js').ScannedAudio}
 */
function audio({ size = 1000, modified = MODIFIED } = {}) {
	return { id: 'Boom.mp3', name: 'Boom.mp3', format: 'mp3', size, modified, absolutePath: '/music/Boom.mp3', optionsPath: '/music/Boom.mp3.json', hasOptions: true };
}

/** @param {{ hash?: string, duration?: number | null }} [answers] */
function readers({ hash = HASH, duration = 12.345 } = {}) {
	/** @type {string[]} */
	const reads = [];
	return {
		reads,
		hashFile: async (/** @type {string} */ path) => {
			reads.push(`hash ${path}`);
			return hash;
		},
		readDuration: async (/** @type {string} */ path) => {
			reads.push(`duration ${path}`);
			return duration;
		},
	};
}

describe('measureIfNeeded', () => {
	it('hashes and measures a file that has no duration yet, rounding to 2 decimals', async () => {
		const io = readers();
		assert.deepEqual(await measureIfNeeded(audio(), { title: 'Boom' }, io), {
			duration: 12.35,
			measuredFrom: { size: 1000, modified: MODIFIED, sha1: HASH },
		});
		assert.deepEqual(io.reads, ['hash /music/Boom.mp3', 'duration /music/Boom.mp3']);
	});

	it('reads nothing when the size and modification time are as recorded', async () => {
		const io = readers();
		const options = { duration: 3, measuredFrom: { size: 1000, modified: MODIFIED, sha1: HASH } };
		assert.equal(await measureIfNeeded(audio(), options, io), null);
		assert.deepEqual(io.reads, []);
	});

	it('only refreshes the record when a touched file still has the same hash', async () => {
		const io = readers();
		const options = { duration: 3, measuredFrom: { size: 1000, modified: '2020-01-01T00:00:00.000Z', sha1: HASH } };
		assert.deepEqual(await measureIfNeeded(audio(), options, io), { duration: 3, measuredFrom: { size: 1000, modified: MODIFIED, sha1: HASH } });
		assert.deepEqual(io.reads, ['hash /music/Boom.mp3']);
	});

	it('measures again when the hash differs, even if the size is the same', async () => {
		const io = readers({ hash: 'b'.repeat(40), duration: 7 });
		const options = { duration: 3, measuredFrom: { size: 1000, modified: '2020-01-01T00:00:00.000Z', sha1: HASH } };
		assert.deepEqual(await measureIfNeeded(audio(), options, io), { duration: 7, measuredFrom: { size: 1000, modified: MODIFIED, sha1: 'b'.repeat(40) } });
	});

	it('measures again when only the size changed', async () => {
		const io = readers({ hash: 'c'.repeat(40) });
		const options = { duration: 3, measuredFrom: { size: 999, modified: MODIFIED, sha1: HASH } };
		assert.equal((await measureIfNeeded(audio(), options, io))?.duration, 12.35);
	});

	it('stores null for an unreadable file, which then counts as measured', async () => {
		const io = readers({ duration: null });
		const measured = await measureIfNeeded(audio(), {}, io);
		assert.deepEqual(measured, { duration: null, measuredFrom: { size: 1000, modified: MODIFIED, sha1: HASH } });
		assert.equal(await measureIfNeeded(audio(), /** @type {any} */ (measured), io), null);
	});
});
