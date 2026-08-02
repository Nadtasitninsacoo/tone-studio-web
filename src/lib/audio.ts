/**
 * Pure audio helpers: gain math, meter scaling, PCM assembly and WAV encoding.
 * No React, no DOM — safe to unit test and to reuse on the NestJS side.
 */

/** Floor of the meter scale in dBFS. Anything quieter reads as silence. */
export const METER_FLOOR_DB = -60;

/** Level at/above which we light the clip indicator. */
export const CLIP_THRESHOLD = 0.99;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Convert a fader position in dB to a linear gain multiplier. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Convert a linear amplitude (0..1) to dBFS. Returns -Infinity for silence. */
export function amplitudeToDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}

/**
 * Map a linear amplitude onto the 0..1 meter scale.
 * Linear-in-dB (not linear-in-amplitude) so the meter matches what engineers expect.
 */
export function amplitudeToMeter(amplitude: number): number {
  if (amplitude <= 0) return 0;
  return clamp((amplitudeToDb(amplitude) - METER_FLOOR_DB) / -METER_FLOOR_DB, 0, 1);
}

/** Inverse of `amplitudeToMeter`, used to place dB tick marks. */
export function dbToMeter(db: number): number {
  return clamp((db - METER_FLOOR_DB) / -METER_FLOOR_DB, 0, 1);
}

/** Format a dB value for a readout, handling the silence case. */
export function formatDb(db: number, digits = 1): string {
  if (!Number.isFinite(db)) return '-∞';
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(digits)}`;
}

/**
 * Concatenate the per-channel chunk batches streamed from the worklet into one
 * contiguous Float32Array per channel.
 */
export function mergeChunks(
  chunks: Float32Array[][],
  channels: number,
): Float32Array<ArrayBuffer>[] {
  const totalFrames = chunks.reduce((sum, chunk) => sum + (chunk[0]?.length ?? 0), 0);
  const merged = Array.from({ length: channels }, () => new Float32Array(totalFrames));

  let offset = 0;
  for (const chunk of chunks) {
    const frames = chunk[0]?.length ?? 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const source = chunk[Math.min(channel, chunk.length - 1)];
      if (source) merged[channel].set(source, offset);
    }
    offset += frames;
  }

  return merged;
}

/** Highest absolute sample across every channel, as dBFS. */
export function peakDbOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const magnitude = Math.abs(channel[i]);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return amplitudeToDb(peak);
}

/**
 * Downsample PCM into a fixed number of envelope buckets for waveform drawing.
 * Uses the per-bucket max so transients (pick attacks) stay visible.
 */
export function computePeaks(channels: Float32Array[], buckets = 480): number[] {
  const frames = channels[0]?.length ?? 0;
  if (frames === 0) return new Array(buckets).fill(0);

  const framesPerBucket = Math.max(1, Math.floor(frames / buckets));
  const peaks: number[] = [];

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * framesPerBucket;
    const end = Math.min(frames, start + framesPerBucket);
    let max = 0;

    for (let i = start; i < end; i += 1) {
      for (const channel of channels) {
        const magnitude = Math.abs(channel[i]);
        if (magnitude > max) max = magnitude;
      }
    }

    peaks.push(max);
  }

  return peaks;
}

/** Write ASCII into a DataView — used for the WAV chunk identifiers. */
function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode interleaved 16-bit PCM into a canonical 44-byte-header RIFF/WAVE blob.
 * Any DAW (Reaper, Ableton, Logic) will open the result without conversion.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // format: 1 = uncompressed PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      // Hard-clip then scale asymmetrically — -32768..32767 is not symmetric.
      const sample = clamp(channels[channel][frame], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
