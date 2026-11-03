import { gzipSync } from 'node:zlib';

/**
 * @typedef {object} TarSpec
 * @property {string} path stored as it is in the name field, so at most 100 bytes
 * @property {string | Buffer} [data]
 * @property {number} [mode]
 * @property {string} [type] `0` file, `2` symbolic link, `5` folder, `L` GNU long name, `x` pax header
 * @property {string} [prefix] the ustar prefix field
 */

/**
 * Builds a `.tar.gz` from raw entries, so a test controls every header.
 * @param {TarSpec[]} entries
 * @returns {Buffer}
 */
export function tarGz(entries) {
	/** @type {Buffer[]} */
	const blocks = [];
	for (const { path, data = '', mode = 0o644, type = '0', prefix = '' } of entries) {
		const body = Buffer.from(data);
		const header = Buffer.alloc(512);
		header.write(path, 0, 100, 'utf8');
		header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 'ascii');
		header.write('0000000\0', 108, 'ascii');
		header.write('0000000\0', 116, 'ascii');
		header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
		header.write('00000000000\0', 136, 'ascii');
		header.write(type, 156, 'ascii');
		header.write('ustar\0' + '00', 257, 'ascii');
		header.write(prefix, 345, 155, 'utf8');
		header.write('        ', 148, 'ascii');
		const checksum = header.reduce((total, byte) => total + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
		blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocks));
}

/**
 * The entries that give the next entry a path longer than the name field, the way GNU tar does.
 * @param {string} path
 * @returns {TarSpec}
 */
export function gnuLongName(path) {
	return { path: '././@LongLink', data: `${path}\0`, type: 'L' };
}

/**
 * A pax header that sets the next entry's path.
 * @param {string} path
 * @returns {TarSpec}
 */
export function paxPath(path) {
	const record = ` path=${path}\n`;
	// The length counts its own digits.
	let length = record.length + 1;
	while (`${length}${record}`.length !== length) {
		length++;
	}
	return { path: 'PaxHeader', data: `${length}${record}`, type: 'x' };
}
