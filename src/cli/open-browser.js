import { spawn } from 'node:child_process';

/**
 * Opens a URL in the default browser with the system's own command. A failure is ignored: the URL is printed anyway.
 * @param {string} url an `http://localhost:<port>` address, with nothing a shell would read specially
 * @param {NodeJS.Platform} [platform]
 */
export function openInBrowser(url, platform = process.platform) {
	/** @type {[string, string[]]} */
	const [command, args] = platform === 'darwin'
		? ['open', [url]]
		: platform === 'win32'
			// The empty first argument is `start`'s window title, which it would otherwise take the URL for.
			? ['cmd', ['/c', 'start', '""', url]]
			: ['xdg-open', [url]];
	try {
		const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: platform === 'win32' });
		child.on('error', () => {});
		child.unref();
	} catch {
		// Nothing to do: the address is in the terminal.
	}
}
