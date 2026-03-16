/**
 * AudioWorklet processor: captures microphone audio, downsamples to 16 kHz,
 * converts to 16-bit PCM and posts chunks to the main thread.
 *
 * Gemini Live API requires: PCM 16-bit, 16000 Hz, mono, little-endian.
 *
 * Usage (main thread):
 *   await audioContext.audioWorklet.addModule('/audio-capture-worklet.js');
 *   const node = new AudioWorkletNode(audioContext, 'audio-capture-processor');
 *   node.port.onmessage = (e) => { // e.data is an ArrayBuffer of Int16 PCM };
 *   micSource.connect(node);
 */

const TARGET_SAMPLE_RATE = 16000;
// How many samples to buffer before posting (100 ms @ 16 kHz = 1600 samples)
const CHUNK_SAMPLES = 1600;

class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(0);
        this._sourceSampleRate = sampleRate; // global from AudioWorkletGlobalScope
        this._ratio = this._sourceSampleRate / TARGET_SAMPLE_RATE;
    }

    /**
     * Simple linear downsampler.
     * For hackathon quality – sufficient for speech at 16 kHz.
     */
    _downsample(input) {
        if (this._ratio === 1) return input;
        const outputLength = Math.floor(input.length / this._ratio);
        const output = new Float32Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
            output[i] = input[Math.floor(i * this._ratio)];
        }
        return output;
    }

    /** Clamp float32 → int16 */
    _toInt16(floatSamples) {
        const int16 = new Int16Array(floatSamples.length);
        for (let i = 0; i < floatSamples.length; i++) {
            const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
            int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        return int16;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        // Take mono (channel 0), downsample, append to buffer
        const mono = this._downsample(input[0]);
        const combined = new Float32Array(this._buffer.length + mono.length);
        combined.set(this._buffer);
        combined.set(mono, this._buffer.length);
        this._buffer = combined;

        // Flush full chunks
        while (this._buffer.length >= CHUNK_SAMPLES) {
            const chunk = this._buffer.slice(0, CHUNK_SAMPLES);
            this._buffer = this._buffer.slice(CHUNK_SAMPLES);
            const pcm16 = this._toInt16(chunk);
            // Transfer the underlying buffer (zero-copy)
            this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
        }

        return true; // keep processor alive
    }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
