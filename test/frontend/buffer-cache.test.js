import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BufferCache } from '../../public/app/logic/buffer-cache.js';

/** @typedef {import('../../public/app/logic/ports.js').BufferHandle} BufferHandle */

/**
 * @param {number} budgetBytes
 * @param {Record<string, number | Error>} [sizes] bytes per URL, or an error to reject with
 */
function setup(budgetBytes, sizes = {}) {
	/** @type {string[]} */
	const loads = [];
	const cache = new BufferCache({
		budgetBytes,
		load: async (url) => {
			loads.push(url);
			const size = sizes[url] ?? 1000;
			if (size instanceof Error) {
				throw size;
			}
			return /** @type {BufferHandle} */ ({ memoryBytes: size, url });
		},
	});
	return { cache, loads };
}

describe('BufferCache', () => {
	it('loads each URL once and shares pending loads', async () => {
		const { cache, loads } = setup(10_000);
		const [first, second] = await Promise.all([cache.get('/a'), cache.get('/a')]);
		assert.equal(first, second);
		assert.equal(await cache.get('/a'), first);
		assert.deepEqual(loads, ['/a']);
		assert.equal(cache.totalBytes, 1000);
	});

	it('forgets a failed load so the next request tries again', async () => {
		const { cache, loads } = setup(10_000, { '/bad': new Error('decode failed') });
		await assert.rejects(cache.get('/bad'), /decode failed/);
		assert.equal(cache.has('/bad'), false);
		await assert.rejects(cache.get('/bad'));
		assert.deepEqual(loads, ['/bad', '/bad']);
	});

	it('evicts the least recently used buffers when over budget', async () => {
		const { cache } = setup(2500);
		await cache.get('/a');
		await cache.get('/b');
		await cache.get('/a');
		await cache.get('/c');
		assert.equal(cache.has('/a'), true);
		assert.equal(cache.has('/b'), false);
		assert.equal(cache.has('/c'), true);
		assert.equal(cache.totalBytes, 2000);
	});

	it('never evicts buffers that are in use, and evicts them once released', async () => {
		const { cache } = setup(1500);
		await cache.get('/a');
		cache.retain('/a');
		await cache.get('/b');
		await cache.get('/c');
		cache.retain('/c');
		assert.equal(cache.has('/a'), true);
		assert.equal(cache.has('/b'), false);
		assert.equal(cache.has('/c'), true);

		cache.release('/a');
		assert.equal(cache.has('/a'), false);
		assert.equal(cache.has('/c'), true);
	});

	it('keeps a just-loaded buffer for its caller even when everything else is in use', async () => {
		const { cache } = setup(1500);
		await cache.get('/a');
		cache.retain('/a');
		await cache.get('/b');
		assert.equal(cache.has('/b'), true);
	});

	it('ignores retain and release for URLs it does not hold', () => {
		const { cache } = setup(1000);
		cache.retain('/nothing');
		cache.release('/nothing');
		assert.equal(cache.totalBytes, 0);
	});
});
