/** Error correction level L, versions 1 to 6: all a link to this server needs, and none of them needs version bits. */
const ECC_CODEWORDS_PER_BLOCK = [7, 10, 15, 20, 26, 18];
const ECC_BLOCKS = [1, 1, 1, 1, 1, 2];
const MAX_VERSION = ECC_BLOCKS.length;
/** Level L is `01` in the format bits. */
const FORMAT_LEVEL_L = 1;

/** Thrown when the text does not fit the largest version this encoder makes. */
export class QrTooLongError extends Error {}

/**
 * Encodes text as a QR code in byte mode with the lowest error correction.
 * @param {string} text
 * @returns {boolean[][]} rows of modules, `true` for dark; without the quiet zone around it
 * @throws {QrTooLongError}
 */
export function encodeQr(text) {
	// `encodeURIComponent` is plain JavaScript, unlike `TextEncoder`: it writes every byte that is not a safe ASCII
	// character as %XX, which is UTF-8.
	const bytes = encodeURIComponent(text)
		.split(/(%[0-9A-F]{2})/)
		.flatMap((part) => (part.startsWith('%') ? [parseInt(part.slice(1), 16)] : [...part].map((char) => char.charCodeAt(0))));
	let version = 1;
	while (version <= MAX_VERSION && bytes.length > dataCodewords(version) - 2) {
		version++;
	}
	if (version > MAX_VERSION) {
		throw new QrTooLongError(`"${text}" is too long for a QR code of this encoder`);
	}
	const size = version * 4 + 17;
	const codewords = interleave(dataOf(bytes, dataCodewords(version)), version);

	/** @type {boolean[][]} */
	const modules = Array.from({ length: size }, () => new Array(size).fill(false));
	/** @type {boolean[][]} */
	const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
	/**
	 * @param {number} x
	 * @param {number} y
	 * @param {boolean} dark
	 */
	const setFunction = (x, y, dark) => {
		modules[y][x] = dark;
		isFunction[y][x] = true;
	};
	drawFunctionPatterns(size, version, setFunction);
	drawFormat(size, 0, setFunction);
	placeCodewords(codewords, modules, isFunction);

	let bestMask = 0;
	let bestPenalty = Infinity;
	for (let mask = 0; mask < 8; mask++) {
		applyMask(modules, isFunction, mask);
		const penalty = runPenalty(modules);
		applyMask(modules, isFunction, mask);
		if (penalty < bestPenalty) {
			bestPenalty = penalty;
			bestMask = mask;
		}
	}
	applyMask(modules, isFunction, bestMask);
	drawFormat(size, bestMask, setFunction);
	return modules;
}

/** @param {number} version */
function rawModules(version) {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const alignments = Math.floor(version / 7) + 2;
		result -= (25 * alignments - 10) * alignments - 55;
	}
	return result;
}

/** @param {number} version */
function dataCodewords(version) {
	return Math.floor(rawModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version - 1] * ECC_BLOCKS[version - 1];
}

/**
 * @param {number[]} bytes
 * @param {number} capacity data codewords of the version
 * @returns {number[]}
 */
function dataOf(bytes, capacity) {
	/** @type {number[]} */
	const bits = [];
	/**
	 * @param {number} value
	 * @param {number} length
	 */
	const push = (value, length) => {
		for (let i = length - 1; i >= 0; i--) {
			bits.push((value >>> i) & 1);
		}
	};
	push(0b0100, 4);
	push(bytes.length, 8);
	for (const byte of bytes) {
		push(byte, 8);
	}
	push(0, Math.min(4, capacity * 8 - bits.length));
	while (bits.length % 8 !== 0) {
		bits.push(0);
	}
	const result = [];
	for (let i = 0; i < bits.length; i += 8) {
		result.push(parseInt(bits.slice(i, i + 8).join(''), 2));
	}
	for (let pad = 0xEC; result.length < capacity; pad ^= 0xEC ^ 0x11) {
		result.push(pad);
	}
	return result;
}

/**
 * Splits the data into blocks, adds each block's error correction and interleaves them.
 * @param {number[]} data
 * @param {number} version
 * @returns {number[]}
 */
function interleave(data, version) {
	const blocks = ECC_BLOCKS[version - 1];
	const eccLength = ECC_CODEWORDS_PER_BLOCK[version - 1];
	const raw = Math.floor(rawModules(version) / 8);
	const shortBlocks = blocks - (raw % blocks);
	const shortLength = Math.floor(raw / blocks);
	const divisor = reedSolomonDivisor(eccLength);
	/** @type {number[][]} */
	const result = [];
	for (let i = 0, offset = 0; i < blocks; i++) {
		const block = data.slice(offset, offset + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
		offset += block.length;
		const ecc = reedSolomonRemainder(block, divisor);
		if (i < shortBlocks) {
			block.push(0);
		}
		result.push(block.concat(ecc));
	}
	/** @type {number[]} */
	const out = [];
	for (let i = 0; i < result[0].length; i++) {
		result.forEach((block, j) => {
			// The padding slot of a short block is skipped.
			if (i !== shortLength - eccLength || j >= shortBlocks) {
				out.push(block[i]);
			}
		});
	}
	return out;
}

/** @param {number} degree */
function reedSolomonDivisor(degree) {
	const result = new Array(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = multiply(result[j], root);
			if (j + 1 < degree) {
				result[j] ^= result[j + 1];
			}
		}
		root = multiply(root, 2);
	}
	return result;
}

/**
 * @param {number[]} data
 * @param {number[]} divisor
 */
function reedSolomonRemainder(data, divisor) {
	const result = new Array(divisor.length).fill(0);
	for (const byte of data) {
		const factor = byte ^ /** @type {number} */ (result.shift());
		result.push(0);
		divisor.forEach((coefficient, i) => {
			result[i] ^= multiply(coefficient, factor);
		});
	}
	return result;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {number} the product in GF(2^8) with the polynomial 0x11D
 */
function multiply(x, y) {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11D);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

/**
 * @param {number} size
 * @param {number} version
 * @param {(x: number, y: number, dark: boolean) => void} set
 */
function drawFunctionPatterns(size, version, set) {
	for (let i = 0; i < size; i++) {
		set(6, i, i % 2 === 0);
		set(i, 6, i % 2 === 0);
	}
	for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const distance = Math.max(Math.abs(dx), Math.abs(dy));
				const x = cx + dx;
				const y = cy + dy;
				if (x >= 0 && x < size && y >= 0 && y < size) {
					set(x, y, distance !== 2 && distance !== 4);
				}
			}
		}
	}
	const positions = alignmentPositions(version, size);
	const last = positions.length - 1;
	positions.forEach((cy, i) => positions.forEach((cx, j) => {
		if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) {
			return;
		}
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
			}
		}
	}));
}

/**
 * @param {number} version
 * @param {number} size
 * @returns {number[]}
 */
function alignmentPositions(version, size) {
	if (version === 1) {
		return [];
	}
	const count = Math.floor(version / 7) + 2;
	const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
	const result = [6];
	for (let position = size - 7; result.length < count; position -= step) {
		result.splice(1, 0, position);
	}
	return result;
}

/**
 * @param {number} size
 * @param {number} mask
 * @param {(x: number, y: number, dark: boolean) => void} set
 */
function drawFormat(size, mask, set) {
	const data = (FORMAT_LEVEL_L << 3) | mask;
	let remainder = data;
	for (let i = 0; i < 10; i++) {
		remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
	}
	const bits = ((data << 10) | remainder) ^ 0x5412;
	/** @param {number} i */
	const bit = (i) => ((bits >>> i) & 1) !== 0;
	for (let i = 0; i <= 5; i++) {
		set(8, i, bit(i));
	}
	set(8, 7, bit(6));
	set(8, 8, bit(7));
	set(7, 8, bit(8));
	for (let i = 9; i < 15; i++) {
		set(14 - i, 8, bit(i));
	}
	for (let i = 0; i < 8; i++) {
		set(size - 1 - i, 8, bit(i));
	}
	for (let i = 8; i < 15; i++) {
		set(8, size - 15 + i, bit(i));
	}
	set(8, size - 8, true);
}

/**
 * @param {number[]} codewords
 * @param {boolean[][]} modules
 * @param {boolean[][]} isFunction
 */
function placeCodewords(codewords, modules, isFunction) {
	const size = modules.length;
	let i = 0;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) {
			right = 5;
		}
		for (let vertical = 0; vertical < size; vertical++) {
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vertical : vertical;
				if (!isFunction[y][x] && i < codewords.length * 8) {
					modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
					i++;
				}
			}
		}
	}
}

/**
 * Flips the modules the mask covers; applying it twice undoes it.
 * @param {boolean[][]} modules
 * @param {boolean[][]} isFunction
 * @param {number} mask
 */
function applyMask(modules, isFunction, mask) {
	for (let y = 0; y < modules.length; y++) {
		for (let x = 0; x < modules.length; x++) {
			if (!isFunction[y][x] && covered(mask, x, y)) {
				modules[y][x] = !modules[y][x];
			}
		}
	}
}

/**
 * @param {number} mask
 * @param {number} x
 * @param {number} y
 */
function covered(mask, x, y) {
	switch (mask) {
		case 0: return (x + y) % 2 === 0;
		case 1: return y % 2 === 0;
		case 2: return x % 3 === 0;
		case 3: return (x + y) % 3 === 0;
		case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
		case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
		default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
	}
}

/**
 * The part of the standard's penalty that matters most: long runs of one color make a code hard to read.
 * @param {boolean[][]} modules
 * @returns {number}
 */
function runPenalty(modules) {
	let penalty = 0;
	const size = modules.length;
	for (const horizontal of [true, false]) {
		for (let a = 0; a < size; a++) {
			let run = 1;
			for (let b = 1; b < size; b++) {
				const same = (horizontal ? modules[a][b] === modules[a][b - 1] : modules[b][a] === modules[b - 1][a]);
				run = same ? run + 1 : 1;
				if (run === 5) {
					penalty += 3;
				} else if (run > 5) {
					penalty++;
				}
			}
		}
	}
	return penalty;
}
