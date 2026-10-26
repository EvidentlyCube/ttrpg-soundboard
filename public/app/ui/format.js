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
