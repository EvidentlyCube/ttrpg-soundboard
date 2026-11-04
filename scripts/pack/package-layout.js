import { EXECUTABLE_MODE, FILE_MODE } from './zip.js';

/** @typedef {import('./platforms.js').Platform} Platform */
/** @typedef {import('./node-runtime.js').Runtime} Runtime */
/** @typedef {import('./zip.js').ZipEntry} ZipEntry */
/** @typedef {{ path: string, data: Buffer }} SourceFile */

/** What goes into `app/`, as paths in the repository. Everything else, tests and docs included, stays out. */
export const APP_PATHS = Object.freeze(['index.js', 'package.json', 'LICENSE', 'src', 'public']);

/** The launcher template in `packaging/` and the name it gets in the package, per system. */
const LAUNCHERS = Object.freeze({
	windows: { template: 'start.cmd', name: 'Start Soundboard.cmd' },
	macos: { template: 'start.sh', name: 'Start Soundboard.command' },
	linux: { template: 'start.sh', name: 'start-soundboard.sh' },
});

/**
 * @param {string} version
 * @param {Platform} platform
 * @returns {string} the zip's name without `.zip`, which is also its top folder
 */
export function packageName(version, platform) {
	return `ttrpg-soundboard-${version}-${platform.name}`;
}

/**
 * Every file in one platform's zip, under a single top folder.
 * @param {object} options
 * @param {Platform} options.platform
 * @param {string} options.version the app's
 * @param {string} options.nodeVersion
 * @param {SourceFile[]} options.appFiles paths relative to the repository
 * @param {Runtime} options.runtime
 * @param {(name: string) => string} options.template a file in `packaging/`
 * @returns {ZipEntry[]}
 */
export function packageEntries({ platform, version, nodeVersion, appFiles, runtime, template }) {
	const top = packageName(version, platform);
	const windows = platform.os === 'windows';
	// Notepad and cmd cope with LF today, but a batch file with LF endings can still misread labels and blocks.
	const text = (/** @type {string} */ content) => Buffer.from(windows ? content.replace(/\r?\n/g, '\r\n') : content);
	const launcher = LAUNCHERS[platform.os];
	const readme = template(`README-${platform.os}.txt`)
		.replaceAll('{{VERSION}}', version)
		.replaceAll('{{NODE_VERSION}}', nodeVersion);
	return [
		{ path: `${top}/${launcher.name}`, data: text(template(launcher.template)), mode: EXECUTABLE_MODE },
		{ path: `${top}/README.txt`, data: text(readme) },
		...appFiles.map(({ path, data }) => ({ path: `${top}/app/${path}`, data, mode: FILE_MODE })),
		{ path: `${top}/runtime/${windows ? 'node.exe' : 'node'}`, data: runtime.binary, mode: EXECUTABLE_MODE },
		{ path: `${top}/runtime/LICENSE`, data: runtime.license },
	];
}
