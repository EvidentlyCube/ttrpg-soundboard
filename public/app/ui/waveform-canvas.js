import { drawWaveform, waveformColumns } from './waveform-draw.js';

/**
 * Draws a waveform on a canvas at its current size and the display's pixel density, in the canvas's text color.
 * Does nothing while the canvas has no size yet; call it again when it gets one.
 * @param {HTMLCanvasElement} canvas
 * @param {Int8Array} peaks min/max byte pairs
 */
export function paintWaveform(canvas, peaks) {
	const context = canvas.getContext('2d');
	const ratio = window.devicePixelRatio || 1;
	const width = Math.round(canvas.clientWidth * ratio);
	const height = Math.round(canvas.clientHeight * ratio);
	if (!context || width === 0 || height === 0) {
		return;
	}
	canvas.width = width;
	canvas.height = height;
	const pitch = Math.max(2, Math.round(2 * ratio));
	context.fillStyle = getComputedStyle(canvas).color;
	drawWaveform(context, waveformColumns(peaks, Math.floor(width / pitch)), width, height, pitch, pitch - Math.max(1, Math.round(ratio / 2)));
}
