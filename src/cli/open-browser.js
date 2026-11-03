import { spawn } from 'node:child_process';

/**
 * Opens a URL in the default browser with the system's own command. A failure is ignored: the URL is printed anyway.
 * @param {string} url an `http://localhost:<port>` address, with nothing a shell would read specially
 * @param {NodeJS.Platform} [platform]
 */
export function openInBrowser(url, platform = process.platform) {
	const [command, args] = browserCommand(url, platform);
	try {
		const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: platform === 'win32' });
		child.on('error', () => {});
		child.unref();
	} catch {
		// Nothing to do: the address is in the terminal.
	}
}

/**
 * @param {string} url
 * @param {NodeJS.Platform} platform
 * @returns {[string, string[]]} the program and its arguments
 */
export function browserCommand(url, platform) {
	if (platform === 'darwin') {
		return ['open', [url]];
	}
	if (platform === 'win32') {
		// The empty first argument is `start`'s window title, which it would otherwise take the URL for.
		return ['cmd', ['/c', 'start', '""', url]];
	}
	return ['xdg-open', [url]];
}
