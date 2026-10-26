const MARGIN = 8;

/**
 * Where to put a popup of `size` that should open at `point`: as requested if it fits, flipped to the other side of
 * the point along an axis where it would overflow, and clamped inside the viewport as a last resort.
 * @param {{ x: number, y: number }} point
 * @param {{ width: number, height: number }} size
 * @param {{ width: number, height: number }} viewport
 */
export function placeInViewport(point, size, viewport) {
	return {
		x: placeOnAxis(point.x, size.width, viewport.width),
		y: placeOnAxis(point.y, size.height, viewport.height),
	};
}

/**
 * @param {number} at
 * @param {number} length
 * @param {number} available
 */
function placeOnAxis(at, length, available) {
	const max = available - length - MARGIN;
	if (at <= max) {
		return Math.max(MARGIN, at);
	}
	if (at - length >= MARGIN) {
		return at - length;
	}
	return Math.max(MARGIN, Math.min(at, max));
}
