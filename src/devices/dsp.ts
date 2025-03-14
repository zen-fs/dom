/* Credit: David Konsumer */
import type { Device, DeviceDriver } from '@zenfs/core';

/* Types pulled from @types/audioworklet */

/* eslint-disable no-var, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioWorkletProcessor) */
interface AudioWorkletProcessor {
	/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioWorkletProcessor/port) */
	readonly port: MessagePort;

	process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
	prototype: AudioWorkletProcessor;
	new (): AudioWorkletProcessor;
};

interface AudioWorkletProcessorConstructor {
	new (options: any): AudioWorkletProcessor;
}

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioWorkletGlobalScope/currentFrame) */
declare var currentFrame: number;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioWorkletGlobalScope/currentTime) */
declare var currentTime: number;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioWorkletGlobalScope/sampleRate) */
declare var sampleRate: number;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioWorkletGlobalScope/registerProcessor) */
declare function registerProcessor(name: string, processor: AudioWorkletProcessorConstructor): void;

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
				outputs[0][0].set(this.buffer.subarray(0, 128));
				this.buffer = this.buffer.subarray(128);
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
		singleton: true,
		init(ino: number, options: DspOptions) {
			return { data: dsp, major: 14, minor: 3 };
		},
		read() {
			return;
		},
		write(device: Device<AudioWorkletNode>, buffer, offset) {
			device.data.port.postMessage(buffer.buffer);
		},
	};
}
