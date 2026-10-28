import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

/** @typedef {import('./library.js').Library} Library */
/** @typedef {import('./library.js').AudioFile} AudioFile */

export const WAVEFORM_BUCKETS = 1024;
/** One minimum and one maximum byte per bucket. */
export const WAVEFORM_BYTES = WAVEFORM_BUCKETS * 2;

const MAGIC = 'SBW1';
const HEADER_BYTES = 16;
const WAVEFORM_EXTENSION = '.wf';

/** The id is not a sound or track of the library. */
export class UnknownWaveformFileError extends Error {
	/** @param {string} id */
	constructor(id) {
		super(`"${id}" is not a sound or track`);
		this.name = 'UnknownWaveformFileError';
	}
}

/** The bytes sent for a waveform are not a waveform. */
export class InvalidWaveformError extends Error {
	constructor() {
		super(`A waveform is exactly ${WAVEFORM_BYTES} bytes`);
		this.name = 'InvalidWaveformError';
	}
}

/**
 * Keeps one waveform file, `<audio file>.wf`, next to each audio file (DESIGN.md §5.1). The file holds a header with
 * the audio file's size and modified time, so a replaced audio file makes its waveform stale, then the peaks.
 */
export class WaveformStore {
	#library;

	/** @param {Library} library */
	constructor(library) {
		this.#library = library;
	}

	/**
	 * The ids of every sound, then every track in playlist order, that has no current waveform.
	 * @returns {Promise<string[]>}
	 */
	async missing() {
		const files = [...this.#library.sounds, ...this.#library.playlists.flatMap((playlist) => playlist.tracks)];
		const current = await Promise.all(files.map(async (file) => (await this.#readCurrent(file)) !== null));
		return files.filter((_, index) => !current[index]).map((file) => file.id);
	}

	/**
	 * @param {string} id
	 * @returns {Promise<Buffer | null>} the peaks, or null when there is no current waveform
	 */
	async read(id) {
		return this.#readCurrent(this.#fileOf(id));
	}

	/**
	 * @param {string} id
	 * @param {Buffer} peaks
	 */
	async write(id, peaks) {
		const file = this.#fileOf(id);
		if (peaks.length !== WAVEFORM_BYTES) {
			throw new InvalidWaveformError();
		}
		const source = await stat(file.absolutePath);
		const header = Buffer.alloc(HEADER_BYTES);
		header.write(MAGIC, 0, 'ascii');
		header.writeUInt16BE(WAVEFORM_BUCKETS, 4);
		header.writeUInt32BE(source.size % 2 ** 32, 8);
		header.writeUInt32BE(Math.floor(source.mtimeMs / 1000) % 2 ** 32, 12);

		const path = file.absolutePath + WAVEFORM_EXTENSION;
		const temporaryPath = `${path}.tmp`;
		try {
			await writeFile(temporaryPath, Buffer.concat([header, peaks]));
			await rename(temporaryPath, path);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => {});
			throw error;
		}
	}

	/** @param {string} id */
	#fileOf(id) {
		const file = this.#library.files.get(id);
		if (!file) {
			throw new UnknownWaveformFileError(id);
		}
		return file;
	}

	/**
	 * @param {AudioFile} file
	 * @returns {Promise<Buffer | null>}
	 */
	async #readCurrent(file) {
		let source;
		let content;
		try {
			source = await stat(file.absolutePath);
			content = await readFile(file.absolutePath + WAVEFORM_EXTENSION);
		} catch {
			return null;
		}
		if (
			content.length !== HEADER_BYTES + WAVEFORM_BYTES
			|| content.toString('ascii', 0, 4) !== MAGIC
			|| content.readUInt16BE(4) !== WAVEFORM_BUCKETS
			|| content.readUInt32BE(8) !== source.size % 2 ** 32
			|| content.readUInt32BE(12) !== Math.floor(source.mtimeMs / 1000) % 2 ** 32
		) {
			return null;
		}
		return content.subarray(HEADER_BYTES);
	}
}
