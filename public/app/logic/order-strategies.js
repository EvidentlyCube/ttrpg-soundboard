/**
 * Decides which track plays first, next and previous. Strategies are pure, so later ones (shuffle) can be seeded
 * and tested the same way.
 * @typedef {object} OrderStrategy
 * @property {() => number | null} first
 * @property {(currentIndex: number) => number | null} next null means the playlist has ended
 * @property {(currentIndex: number) => number | null} previous null means there is nothing before
 */

/** @typedef {(trackCount: number, options: { loop: boolean }) => OrderStrategy} OrderStrategyFactory */

/** @type {Record<string, OrderStrategyFactory>} */
const ORDER_STRATEGIES = {
	sequential: createSequentialOrder,
};

/**
 * @param {string} name
 * @param {number} trackCount
 * @param {{ loop: boolean }} options
 */
export function createOrderStrategy(name, trackCount, options) {
	const factory = ORDER_STRATEGIES[name];
	if (!factory) {
		throw new Error(`Unknown order strategy "${name}"`);
	}
	return factory(trackCount, options);
}

/** @type {OrderStrategyFactory} */
function createSequentialOrder(trackCount, { loop }) {
	if (trackCount === 0) {
		return { first: () => null, next: () => null, previous: () => null };
	}
	return {
		first: () => 0,
		next: (index) => (index + 1 < trackCount ? index + 1 : loop ? 0 : null),
		previous: (index) => (index > 0 ? index - 1 : loop ? trackCount - 1 : null),
	};
}
