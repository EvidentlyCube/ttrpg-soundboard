/** The Node.js release every package carries, changed by hand. */
export const NODE_VERSION = '24.22.2';

/**
 * @typedef {object} Platform
 * @property {string} name used in the zip's name
 * @property {'windows' | 'macos' | 'linux'} os picks the launcher and the README
 * @property {string} node the platform's name in Node's download file names
 */

/** @type {readonly Platform[]} */
export const PLATFORMS = Object.freeze([
	{ name: 'windows-x64', os: 'windows', node: 'win-x64' },
	{ name: 'macos-arm64', os: 'macos', node: 'darwin-arm64' },
	{ name: 'macos-x64', os: 'macos', node: 'darwin-x64' },
	{ name: 'linux-x64', os: 'linux', node: 'linux-x64' },
]);
