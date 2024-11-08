/* Types pulled from @types/audioworklet */

/* eslint-disable no-var, @typescript-eslint/no-explicit-any */

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
