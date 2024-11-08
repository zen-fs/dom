/* Credit: David Konsumer */
import type { DeviceDriver, DeviceFile } from '@zenfs/core';
import './audioworklet.d.ts';

if ('AudioWorkletProcessor' in globalThis) {
	class Dsp extends AudioWorkletProcessor {
		protected buffer?: Float32Array;

		public constructor() {
			super();
			this.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
				this.buffer = new Float32Array(data);
			};
		}

		public process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
			if (this.buffer && this.buffer.byteLength >= 128) {
				outputs[0][0].set(this.buffer.slice(0, 128));
				this.buffer = this.buffer.slice(128);
			}
			return true;
		}

		public static get parameterDescriptors() {
			return [
				{
					name: 'gain',
					defaultValue: 1,
					minValue: 0,
					maxValue: 1,
					automationRate: 'a-rate',
				},
			];
		}
	}

	registerProcessor('zenfs:dsp', Dsp);
}

export interface DspOptions {
	audioContext?: AudioContext;
}

export async function dsp(options: DspOptions = {}): Promise<DeviceDriver<AudioWorkletNode>> {
	const context = options.audioContext || new AudioContext();

	await context.audioWorklet.addModule(import.meta.url);

	const dsp = new AudioWorkletNode(context, 'zenfs:dsp');
	dsp.connect(context.destination);

	// add a click-handler to resume (due to web security) https://goo.gl/7K7WLu
	document.addEventListener('click', () => {
		if (context.state != 'running') {
			void context.resume().catch(() => {});
		}
	});

	return {
		name: 'dsp',
		init() {
			return { data: dsp, major: 14, minor: 3 };
		},
		read() {
			return 0;
		},
		write(file: DeviceFile, data: Uint8Array): number {
			dsp.port.postMessage(data.buffer);
			return data.byteLength;
		},
	};
}
