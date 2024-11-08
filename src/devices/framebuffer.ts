/* Credit: David Konsumer */
import { Errno, ErrnoError } from '@zenfs/core';
import type { DeviceDriver, DeviceFile } from '@zenfs/core';

export interface FramebufferOptions {
	canvas?: HTMLCanvasElement | null;
}

let framebufferN = 0;

export function framebuffer({ canvas }: FramebufferOptions = {}): DeviceDriver<CanvasRenderingContext2D> {
	if (!canvas) {
		canvas = document.createElement('canvas');
		document.body.appendChild(canvas);
	}
	const ctx = canvas.getContext('2d');

	if (!ctx) {
		throw new ErrnoError(Errno.EIO, 'Could not get context from canvas whilst initializing frame buffer.');
	}

	return {
		name: 'framebuffer',
		init() {
			return { data: ctx, major: 29, minor: framebufferN++ };
		},
		read() {
			return 0;
		},
		write(file: DeviceFile, data: Uint8Array) {
			if (data.byteLength < 4 * canvas.width * canvas.height) {
				return 0;
			}
			const imageData = new ImageData(new Uint8ClampedArray(data), canvas.width, canvas.height);
			ctx.putImageData(imageData, 0, 0);
			return data.byteLength;
		},
	};
}
