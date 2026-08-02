/**
 * recorder-processor.js — AudioWorklet capture node.
 *
 * Runs on the real-time audio render thread. Its only job is to copy incoming
 * PCM frames into a batch buffer and ship them to the main thread, so the UI
 * thread never has to keep up with the 128-frame render quantum.
 *
 * We capture raw Float32 PCM (instead of using MediaRecorder) for two reasons:
 *   1. MediaRecorder gives lossy WebM/Opus — unacceptable for guitar tracking.
 *   2. We need bit-exact samples to write a real 16-bit PCM .wav file.
 *
 * Protocol (main thread -> worklet):
 *   { type: 'record', value: boolean }  arm/disarm capture (disarm flushes tail)
 *   { type: 'flush' }                   force-flush the partial batch
 * Protocol (worklet -> main thread):
 *   { type: 'chunk', channels: Float32Array[] }  one batch, per channel
 */

/** Frames per postMessage. 4096 @48kHz ≈ 85ms — ~12 messages/sec instead of 375. */
const BATCH_FRAMES = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    /** @type {number} Channel count locked in at construction time. */
    this.channels = Math.max(1, options?.processorOptions?.channels ?? 1);
    this.recording = false;
    this.filled = 0;
    this.batch = this.allocate();

    this.port.onmessage = (event) => {
      const { type, value } = event.data ?? {};

      if (type === 'record') {
        const next = Boolean(value);
        // Starting a fresh capture: drop whatever was half-buffered.
        if (next && !this.recording) this.reset();
        this.recording = next;
        // Stopping: push the trailing partial batch so no audio is lost.
        if (!next) this.flush();
      }

      if (type === 'flush') this.flush();
    };
  }

  /** Allocate one batch buffer per channel. */
  allocate() {
    return Array.from({ length: this.channels }, () => new Float32Array(BATCH_FRAMES));
  }

  reset() {
    this.batch = this.allocate();
    this.filled = 0;
  }

  /** Send the filled portion of the batch to the main thread (zero-copy transfer). */
  flush() {
    if (this.filled === 0) return;

    const channels = this.batch.map((channel) => channel.slice(0, this.filled));
    this.port.postMessage(
      { type: 'chunk', channels },
      channels.map((channel) => channel.buffer),
    );

    // slice() detached nothing, but the buffers above are transferred — reallocate.
    this.reset();
  }

  process(inputs) {
    const input = inputs[0];

    // No upstream connection yet (or nothing to do) — keep the node alive.
    if (!this.recording || !input || input.length === 0) return true;

    const frames = input[0].length;
    let read = 0;

    // A render quantum can straddle a batch boundary, so copy in slices.
    while (read < frames) {
      const count = Math.min(frames - read, BATCH_FRAMES - this.filled);

      for (let channel = 0; channel < this.channels; channel += 1) {
        // Mono source feeding a stereo capture: duplicate the last real channel.
        const source = input[Math.min(channel, input.length - 1)];
        this.batch[channel].set(source.subarray(read, read + count), this.filled);
      }

      this.filled += count;
      read += count;

      if (this.filled === BATCH_FRAMES) this.flush();
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
