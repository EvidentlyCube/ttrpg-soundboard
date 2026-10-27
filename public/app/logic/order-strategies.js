/**
 * How a playlist moves through its tracks (DESIGN.md §8.2). Each order fills the playlist's play history: `start` gives
 * its first entries and where the cursor goes, `extend` the entries to append once the history runs out. Entries are
 * track indices. The functions are pure apart from the injected `random`, so a seeded generator makes them repeatable.
 * @typedef {object} OrderStrategy
 * @property {(trackCount: number, random: () => number, at: number | null) => { entries: number[], cursor: number }} start
 * 	`at` is a track to start at, chosen in the track list or playing when the order changed
 * @property {(trackCount: number, random: () => number, last: number) => number[]} extend `last` is the history's last entry
 */

/** The orders a playlist can have; the first is the default. */
export const PLAYBACK_ORDERS = /** @type {const} */ (['ordered', 'random', 'shuffle']);

/** @typedef {typeof PLAYBACK_ORDERS[number]} PlaybackOrder */

/** @type {Record<PlaybackOrder, OrderStrategy>} */
const STRATEGIES = {
	ordered: {
		start: (trackCount, _random, at) => ({ entries: indices(trackCount), cursor: at ?? 0 }),
		extend: (trackCount) => indices(trackCount),
	},
	random: {
		start: (trackCount, random, at) => ({ entries: trackCount > 0 ? [at ?? pick(trackCount, random, null)] : [], cursor: 0 }),
		extend: (trackCount, random, last) => (trackCount > 0 ? [pick(trackCount, random, last)] : []),
	},
	shuffle: {
		start: (trackCount, random, at) => {
			const entries = shuffled(trackCount, random);
			if (at !== null) {
				swap(entries, 0, entries.indexOf(at));
			}
			return { entries, cursor: 0 };
		},
		extend: (trackCount, random, last) => {
			const entries = shuffled(trackCount, random);
			if (trackCount > 1 && entries[0] === last) {
				swap(entries, 0, 1 + Math.floor(random() * (trackCount - 1)));
			}
			return entries;
		},
	},
};

/**
 * @param {PlaybackOrder} name
 * @returns {OrderStrategy}
 */
export function orderStrategy(name) {
	const strategy = Object.hasOwn(STRATEGIES, name) ? STRATEGIES[name] : null;
	if (!strategy) {
		throw new Error(`Unknown playback order "${name}"`);
	}
	return strategy;
}

/** @param {number} count */
function indices(count) {
	return Array.from({ length: count }, (_, index) => index);
}

/**
 * A random track other than `avoid`, chosen among the others directly so it never has to retry; with a single track
 * that track is the only answer.
 * @param {number} trackCount at least 1
 * @param {() => number} random
 * @param {number | null} avoid
 */
function pick(trackCount, random, avoid) {
	if (avoid === null || trackCount === 1) {
		return Math.floor(random() * trackCount);
	}
	const index = Math.floor(random() * (trackCount - 1));
	return index >= avoid ? index + 1 : index;
}

/**
 * Every track once, in a random order (Fisher–Yates).
 * @param {number} trackCount
 * @param {() => number} random
 */
function shuffled(trackCount, random) {
	const entries = indices(trackCount);
	for (let i = entries.length - 1; i > 0; i--) {
		swap(entries, i, Math.floor(random() * (i + 1)));
	}
	return entries;
}

/**
 * @param {number[]} entries
 * @param {number} a
 * @param {number} b
 */
function swap(entries, a, b) {
	[entries[a], entries[b]] = [entries[b], entries[a]];
}
