/* Credit: David Konsumer */
import type { DeviceDriver, DeviceFile } from '@zenfs/core';
import { Errno, ErrnoError } from '@zenfs/core';

export interface FramebufferOptions {
	canvas?: HTMLCanvasElement | null;
}

let framebufferN = 0;

/**
 * A frame buffer
 *
 * Setup:
 * ```
 * addDevice(framebuffer, { canvas: document.querySelector('#your-canvas') })
 * ```
 */
export const framebuffer: DeviceDriver<CanvasRenderingContext2D> = {
	name: 'framebuffer',
	init(ino: bigint, { canvas }: FramebufferOptions = {}) {
		if (!canvas) {
			canvas = document.createElement('canvas');
			document.body.appendChild(canvas);
		}
		const ctx = canvas.getContext('2d');

		if (!ctx) {
			throw new ErrnoError(Errno.EIO, 'Could not get context from canvas whilst initializing frame buffer.');
		}

		return { data: ctx, major: 29, minor: framebufferN++, name: 'fb' };
	},
	read() {
		return 0;
	},
	write(file: DeviceFile<CanvasRenderingContext2D>, data: Uint8Array) {
		const { width, height } = file.device.data.canvas;
		if (data.byteLength < 4 * width * height) {
			return 0;
		}
		const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
		file.device.data.putImageData(imageData, 0, 0);
		return data.byteLength;
	},
};
