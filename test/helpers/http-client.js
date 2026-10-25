import { request } from 'node:http';
import { createServer } from 'node:net';

/**
 * Sends a request with the path exactly as given. Unlike fetch, nothing normalizes `..` or percent-encoding first,
 * which is what path traversal tests need.
 * @param {string} baseUrl
 * @param {string} rawPath
 * @param {{ method?: string, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer }>}
 */
export function rawRequest(baseUrl, rawPath, { method = 'GET', headers = {} } = {}) {
	const { hostname, port } = new URL(baseUrl);
	return new Promise((resolve, reject) => {
		const outgoing = request({ hostname, port, path: rawPath, method, headers }, (response) => {
			/** @type {Buffer[]} */
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
			response.on('error', reject);
		});
		outgoing.on('error', reject);
		outgoing.end();
	});
}

/**
 * Finds a port that is free right now by letting the OS pick one.
 * @returns {Promise<number>}
 */
export function findFreePort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}
