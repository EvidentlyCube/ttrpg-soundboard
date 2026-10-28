/** An external program the downloads need is not installed. */
export class ToolMissingError extends Error {
	/** @param {string} command */
	constructor(command) {
		super(`${command} is not installed`);
		this.name = 'ToolMissingError';
		this.command = command;
	}
}

/** Downloads are off because `yt-dlp` or `ffmpeg` wasn't found when the app started. */
export class ToolsUnavailableError extends Error {
	/** @param {string[]} missing */
	constructor(missing) {
		super(`Downloads need yt-dlp and ffmpeg. Not found: ${missing.join(', ')}. Install them, then restart the app.`);
		this.name = 'ToolsUnavailableError';
		this.missing = missing;
	}
}

/** A link that can't be downloaded; the message says why, in words for the user. */
export class UnusableLinkError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'UnusableLinkError';
	}
}

/** A download was asked for while another one runs. */
export class DownloadBusyError extends Error {
	constructor() {
		super('Another download is still running');
		this.name = 'DownloadBusyError';
	}
}

/** A download request that doesn't fit the lookup it refers to. */
export class InvalidDownloadError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'InvalidDownloadError';
	}
}
