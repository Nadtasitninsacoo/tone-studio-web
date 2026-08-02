/**
 * MP3 encoding.
 *
 * The browser has no MP3 encoder — `MediaRecorder` will not produce one on any
 * engine — so this is a pure-JS LAME port (`@breezystack/lamejs`). That is a real
 * dependency and a real cost, taken deliberately: WAV is honest but a 4-minute
 * mix is ~45 MB, which is not something anyone wants to keep on a phone.
 *
 * WAV export stays the lossless path and is not replaced. This is the "small file
 * to keep or send" path, and it is lossy by definition.
 *
 * It can only encode audio this app actually has samples for: recorded takes,
 * local or linked video files, and mixes of those. Audio playing inside a
 * cross-origin player (YouTube) never enters the graph, so it can never be
 * encoded here.
 */

/** Samples handed to LAME per call. The reference implementation's block size. */
const BLOCK_SIZE = 1152;

/** Default rate. 192 kbps stereo is transparent enough for a guitar mix. */
export const DEFAULT_MP3_KBPS = 192;

/** Bit rates LAME accepts, for a UI that offers a choice. */
export const MP3_BITRATES = [128, 192, 256, 320] as const;

/**
 * Float samples in −1..1 to the signed 16-bit LAME expects.
 *
 * Clamped before scaling, and scaled by 32767 rather than 32768: overshooting
 * wraps a loud peak to the opposite polarity, which is an audible click exactly
 * where the music is loudest.
 */
function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    out[i] = Math.round(sample * 32767);
  }
  return out;
}

/**
 * Encode a rendered buffer to MP3.
 *
 * Mono and stereo only, which is everything this app produces. Anything wider is
 * folded to its first two channels rather than failing.
 *
 * Async purely so the encoder can be imported on demand: it is ~200 kB of LAME,
 * and nobody should download it to open the page when it is only needed by a
 * button they may never press.
 */
export async function encodeMp3(
  buffer: AudioBuffer,
  kbps: number = DEFAULT_MP3_KBPS,
): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');

  const channels = Math.min(2, buffer.numberOfChannels);
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps);

  const left = toInt16(buffer.getChannelData(0));
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null;

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < left.length; offset += BLOCK_SIZE) {
    const end = Math.min(offset + BLOCK_SIZE, left.length);
    const encoded = right
      ? encoder.encodeBuffer(left.subarray(offset, end), right.subarray(offset, end))
      : encoder.encodeBuffer(left.subarray(offset, end));
    // A block often produces nothing; LAME emits a frame once it has enough.
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}
