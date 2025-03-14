/* Credit: David Konsumer */
import type { Device, DeviceDriver } from '@zenfs/core';
import { Errno, ErrnoError } from '@zenfs/core';

export interface FramebufferOptions {
	canvas?: HTMLCanvasElement | null;
}

export interface FramebufferData {
	context: CanvasRenderingContext2D;
	image: ImageData;
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
export const framebuffer: DeviceDriver<FramebufferData> = {
	name: 'framebuffer',
	init(ino: number, { canvas }: FramebufferOptions = {}) {
		if (!canvas) {
			canvas = document.createElement('canvas');
			document.body.appendChild(canvas);
		}
		const context = canvas.getContext('2d');

		if (!context) {
			throw new ErrnoError(Errno.EIO, 'Could not get context from canvas whilst initializing frame buffer.');
		}

		const image = new ImageData(canvas.width, canvas.height);

		return {
			data: { context, image },
			major: 29,
			minor: framebufferN++,
			name: 'fb',
		};
	},
	read() {},
	write({ data: { image, context } }: Device<FramebufferData>, buffer, offset) {
		image.data.set(buffer, offset);
		context.putImageData(image, 0, 0);
		return buffer.byteLength;
	},
};
