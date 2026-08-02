/**
 * Print the amp into a take — offline, faster than real time.
 *
 * The recorder captures dry and applies the amp only to monitoring, so the WAV on
 * disk is the performance and the tone stays editable forever. This is the other
 * half of that decision: when a take is finished, render a second file with the amp
 * committed, without ever touching the original.
 *
 * `OfflineAudioContext` rather than recording the monitor path in real time. A
 * realtime bounce would take as long as the take, would capture whatever the
 * machine was doing at the time, and would be at the mercy of a dropped buffer. An
 * offline render is deterministic and runs as fast as the CPU allows.
 */

import { encodeWav } from '@/lib/audio';
import { AMP_WORKLET_URL, type AmpSettings, createAmpChain } from '@/lib/ampFx';

/** Extra time rendered past the end so tails are not cut off. */
function tailSeconds(settings: AmpSettings): number {
  // Delay repeats decay by `feedback` each pass; solve for -60 dB rather than
  // guessing a fixed tail, or a long feedback setting gets chopped.
  const repeats =
    settings.delay.enabled && settings.delay.feedback > 0.01
      ? Math.log(0.001) / Math.log(Math.min(0.9, settings.delay.feedback))
      : 1;
  const delayTail = settings.delay.enabled ? settings.delay.timeSec * Math.min(repeats, 24) : 0;
  const reverbTail = settings.reverb.enabled ? settings.reverb.sizeSec * 1.1 : 0;
  // Never less than 100 ms: the limiter's look-ahead and the filters have their own
  // short tails even with both sends off.
  return Math.max(0.1, delayTail, reverbTail);
}

export interface AmpRenderResult {
  blob: Blob;
  /** Peak of the rendered file in dBFS, so the caller can report it. */
  peakDb: number;
  durationSec: number;
}

/**
 * Render `source` through the amp and return a 16-bit WAV.
 *
 * `onProgress` is called with 0..1 at the decode and render boundaries. Web Audio
 * gives no progress out of `startRendering`, so this is coarse by nature — better
 * than a spinner that says nothing, and honest about not being a real percentage.
 */
export async function renderWithAmp(
  source: ArrayBuffer,
  settings: AmpSettings,
  onProgress?: (ratio: number) => void,
): Promise<AmpRenderResult> {
  onProgress?.(0.05);

  // Decode in a throwaway realtime context: OfflineAudioContext needs the length up
  // front, so the source has to be decoded before the render context can exist.
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(source.slice(0));
  } finally {
    void probe.close();
  }

  onProgress?.(0.2);

  const sampleRate = decoded.sampleRate;
  const tail = tailSeconds(settings);
  const frames = Math.ceil((decoded.duration + tail) * sampleRate);

  // Always render stereo: the cabinet stage is dual-mono and the reverb tail is
  // stereo, so a mono render would collapse both and sound narrower than what was
  // monitored.
  const offline = new OfflineAudioContext(2, frames, sampleRate);

  // The gate and limiter are AudioWorkletProcessors, so the module has to be
  // registered in *this* context — worklet modules do not carry across contexts.
  await offline.audioWorklet.addModule(AMP_WORKLET_URL);

  const amp = createAmpChain(offline, settings);

  const player = offline.createBufferSource();
  player.buffer = decoded;
  player.connect(amp.input);
  amp.output.connect(offline.destination);
  player.start(0);

  onProgress?.(0.3);
  const rendered = await offline.startRendering();
  onProgress?.(0.9);

  // Trim the limiter's look-ahead latency off the head.
  //
  // The limiter delays its input by 3 ms so it can see peaks coming. Left in, the
  // printed file sits 3 ms later than the dry take and the two no longer line up if
  // anyone stacks them. The delay is a known constant, so removing it is exact
  // rather than a guess.
  const latency = Math.round(0.003 * sampleRate);
  const outFrames = Math.max(1, rendered.length - latency);

  const channels: Float32Array[] = [];
  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const full = rendered.getChannelData(channel);
    const trimmed = full.subarray(latency, latency + outFrames);
    for (let i = 0; i < trimmed.length; i += 1) {
      const magnitude = Math.abs(trimmed[i]);
      if (magnitude > peak) peak = magnitude;
    }
    channels.push(trimmed);
  }

  amp.disconnect();
  onProgress?.(1);

  return {
    blob: encodeWav(channels, sampleRate),
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    durationSec: outFrames / sampleRate,
  };
}

/** `take-03.wav` -> `take-03_amp.wav`, so the two can never be confused. */
export function ampFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}_amp${name.slice(dot)}` : `${name}_amp.wav`;
}
