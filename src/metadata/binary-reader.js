import { open } from 'node:fs/promises';

/**
 * Random-access reads that never fail on out-of-range positions: they return whatever bytes exist, possibly none.
 * Parsers rely on this to treat truncated files as malformed data rather than errors.
 * @typedef {object} ByteSource
 * @property {number} size
 * @property {(position: number, length: number) => Promise<Buffer>} read
 * @property {() => Promise<void>} close
 */

/** @implements {ByteSource} */
export class BinaryReader {
	#handle;

	/**
	 * @param {import('node:fs/promises').FileHandle} handle
	 * @param {number} size
	 */
	constructor(handle, size) {
		this.#handle = handle;
		this.size = size;
	}

	/** @param {string} path */
	static async open(path) {
		const handle = await open(path, 'r');
		try {
			const { size } = await handle.stat();
			return new BinaryReader(handle, size);
		} catch (error) {
			await handle.close();
			throw error;
		}
	}

	/**
	 * @param {number} position
	 * @param {number} length
	 */
	async read(position, length) {
		const available = clampLength(position, length, this.size);
		if (available === 0) {
			return Buffer.alloc(0);
		}
		const buffer = Buffer.alloc(available);
		const { bytesRead } = await this.#handle.read(buffer, 0, available, position);
		return buffer.subarray(0, bytesRead);
	}

	close() {
		return this.#handle.close();
	}
}

/** @implements {ByteSource} */
export class BufferReader {
	#bytes;

	/** @param {Buffer} bytes */
	constructor(bytes) {
		this.#bytes = bytes;
		this.size = bytes.length;
	}

	/**
	 * @param {number} position
	 * @param {number} length
	 */
	async read(position, length) {
		const available = clampLength(position, length, this.size);
		return available === 0 ? Buffer.alloc(0) : this.#bytes.subarray(position, position + available);
	}

	async close() {}
}

/**
 * @param {number} position
 * @param {number} length
 * @param {number} size
 */
function clampLength(position, length, size) {
	if (position < 0 || position >= size || length <= 0) {
		return 0;
	}
	return Math.min(length, size - position);
}
