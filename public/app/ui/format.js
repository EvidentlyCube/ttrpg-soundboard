/**
 * A file size in decimal units, as operating systems show them: `840 KB`, `1.4 GB`.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit++;
	}
	return unit === 0 ? `${value} B` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * `m:ss`, or `h:mm:ss` from an hour on; `--:--` while the time is unknown.
 * @param {number | null} seconds
 */
export function formatTime(seconds) {
	if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
		return '--:--';
	}
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const paddedSeconds = String(total % 60).padStart(2, '0');
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
		: `${minutes}:${paddedSeconds}`;
}
