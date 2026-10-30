import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, QrTooLongError } from '../../public/app/logic/qr-code.js';

/**
 * @param {boolean[][]} modules
 * @param {number} x
 * @param {number} y
 */
function finderAt(modules, x, y) {
	for (let dy = 0; dy < 7; dy++) {
		for (let dx = 0; dx < 7; dx++) {
			const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
			assert.equal(modules[y + dy][x + dx], ring !== 2, `finder at ${x},${y}: module ${dx},${dy}`);
		}
	}
}

/** @param {number} bits the 15 format bits of a code, masked as written */
function isValidFormat(bits) {
	const data = (bits ^ 0x5412) >>> 10;
	let remainder = data;
	for (let i = 0; i < 10; i++) {
		remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
	}
	return (((data << 10) | remainder) ^ 0x5412) === bits;
}

describe('encodeQr', () => {
	it('picks the smallest version that holds the text', () => {
		assert.equal(encodeQr('a').length, 21);
		assert.equal(encodeQr('a'.repeat(17)).length, 21);
		assert.equal(encodeQr('a'.repeat(18)).length, 25);
		assert.equal(encodeQr('http://192.168.1.252:3000/').length, 25);
		assert.equal(encodeQr('a'.repeat(100)).length, 37);
		assert.equal(encodeQr('a'.repeat(134)).length, 41);
	});

	it('draws the three finder patterns and the timing patterns', () => {
		const modules = encodeQr('http://192.168.1.20:3000/');
		const size = modules.length;
		finderAt(modules, 0, 0);
		finderAt(modules, size - 7, 0);
		finderAt(modules, 0, size - 7);
		for (let i = 8; i < size - 8; i++) {
			assert.equal(modules[6][i], i % 2 === 0, `row 6, column ${i}`);
			assert.equal(modules[i][6], i % 2 === 0, `column 6, row ${i}`);
		}
		assert.equal(modules[size - 8][8], true, 'the one module that is always dark');
	});

	it('writes the same valid format bits in both places', () => {
		for (const text of ['a', 'http://192.168.1.20:3000/', 'x'.repeat(60)]) {
			const modules = encodeQr(text);
			const size = modules.length;
			/** @type {(positions: [number, number][]) => number} */
			const read = (positions) => positions.reduce((bits, [x, y], i) => bits | ((modules[y][x] ? 1 : 0) << i), 0);
			const first = read([
				[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
			]);
			const second = read([
				...Array.from({ length: 8 }, (_, i) => /** @type {[number, number]} */ ([size - 1 - i, 8])),
				...Array.from({ length: 7 }, (_, i) => /** @type {[number, number]} */ ([8, size - 7 + i])),
			]);
			assert.equal(first, second, text);
			assert.equal(isValidFormat(first), true, text);
			assert.equal((first ^ 0x5412) >>> 13, 0b01, 'error correction level L');
		}
	});

	it('gives the same code for the same text and a different one for other text', () => {
		const link = 'http://192.168.1.20:3000/';
		assert.deepEqual(encodeQr(link), encodeQr(link));
		assert.notDeepEqual(encodeQr(link), encodeQr('http://192.168.1.21:3000/'));
	});

	it('counts the bytes of non-ASCII text, not its characters', () => {
		assert.equal(encodeQr('é'.repeat(8)).length, 21);
		assert.equal(encodeQr('é'.repeat(9)).length, 25);
	});

	it('refuses text that is too long', () => {
		assert.throws(() => encodeQr('a'.repeat(200)), QrTooLongError);
	});
});
