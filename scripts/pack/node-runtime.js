import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PackError } from './errors.js';
import { readTarGz } from './tar.js';

/** @typedef {import('./platforms.js').Platform} Platform */
/** @typedef {(url: string) => Promise<Buffer>} Download */
/** @typedef {{ binary: Buffer, license: Buffer }} Runtime */

const BASE_URL = 'https://nodejs.org/dist';

/** @type {Download} */
export async function downloadWithFetch(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new PackError(`Downloading ${url} failed: ${response.status} ${response.statusText}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

/**
 * The official Node.js binary and its license for each platform. Every file is checked against the release's
 * `SHASUMS256.txt` and kept in a cache folder, so later packs need no network.
 */
export class NodeRuntimes {
	#version;
	#cacheFolder;
	#download;
	/** @type {Promise<Map<string, string>> | null} file name → SHA-256 */
	#checksums = null;

	/**
	 * @param {object} options
	 * @param {string} options.version
	 * @param {string} options.cacheFolder
	 * @param {Download} [options.download]
	 */
	constructor({ version, cacheFolder, download = downloadWithFetch }) {
		this.#version = version;
		this.#cacheFolder = join(cacheFolder, `node-v${version}`);
		this.#download = download;
	}

	/**
	 * @param {Platform} platform
	 * @returns {Promise<Runtime>}
	 */
	async runtimeFor(platform) {
		if (platform.os === 'windows') {
			// Node's Windows downloads are a zip and installers; its `node.exe` is also published on its own. The license
			// is the same file in every archive.
			const binary = await this.#file(`${platform.node}/node.exe`);
			const { license } = await this.#fromTarball('linux-x64');
			return { binary, license };
		}
		return this.#fromTarball(platform.node);
	}

	/**
	 * @param {string} node
	 * @returns {Promise<Runtime>}
	 */
	async #fromTarball(node) {
		const top = `node-v${this.#version}-${node}`;
		const files = readTarGz(await this.#file(`${top}.tar.gz`));
		const find = (/** @type {string} */ path) => {
			const file = files.find((candidate) => candidate.path === `${top}/${path}`);
			if (!file) {
				throw new PackError(`${top}.tar.gz has no ${path}.`);
			}
			return file.data;
		};
		return { binary: find('bin/node'), license: find('LICENSE') };
	}

	/**
	 * A release file, from the cache when it is there and intact.
	 * @param {string} name as `SHASUMS256.txt` lists it
	 * @returns {Promise<Buffer>}
	 */
	async #file(name) {
		const expected = (await this.#loadChecksums()).get(name);
		if (!expected) {
			throw new PackError(`Node v${this.#version} has no ${name}.`);
		}
		const cached = join(this.#cacheFolder, name.replaceAll('/', '-'));
		const existing = await readFile(cached).catch(() => null);
		if (existing && sha256(existing) === expected) {
			return existing;
		}
		const url = `${BASE_URL}/v${this.#version}/${name}`;
		const data = await this.#download(url);
		if (sha256(data) !== expected) {
			throw new PackError(`${url} does not match its checksum in SHASUMS256.txt.`);
		}
		await writeCached(cached, data);
		return data;
	}

	/** @returns {Promise<Map<string, string>>} */
	#loadChecksums() {
		this.#checksums ??= this.#readChecksums();
		return this.#checksums;
	}

	/** @returns {Promise<Map<string, string>>} */
	async #readChecksums() {
		const cached = join(this.#cacheFolder, 'SHASUMS256.txt');
		let text = await readFile(cached, 'utf8').catch(() => null);
		if (text === null) {
			const data = await this.#download(`${BASE_URL}/v${this.#version}/SHASUMS256.txt`);
			await writeCached(cached, data);
			text = data.toString('utf8');
		}
		// Each line is `<sha256>  <file name>`.
		return new Map(text.split('\n').filter(Boolean).map((line) => {
			const [hash, name] = line.trim().split(/\s+/);
			return [name, hash];
		}));
	}
}

/**
 * @param {Buffer} data
 * @returns {string}
 */
function sha256(data) {
	return createHash('sha256').update(data).digest('hex');
}

/**
 * Written under a temporary name first, so a pack stopped halfway never leaves a truncated file in the cache.
 * @param {string} path
 * @param {Buffer} data
 */
async function writeCached(path, data) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(`${path}.tmp`, data);
	await rename(`${path}.tmp`, path);
}
