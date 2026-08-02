/**
 * Radix-2 FFT.
 *
 * Written out rather than pulled from npm because it is ~60 lines, the beat
 * tracker is its only caller, and a dependency here would have to be audited for
 * the same thing this file does in one screen.
 *
 * In-place, iterative Cooley–Tukey. Twiddle factors and the bit-reversal
 * permutation are cached per transform size, which matters: onset detection runs
 * thousands of same-sized transforms back to back.
 */

interface Tables {
  cos: Float32Array;
  sin: Float32Array;
  /** Bit-reversed index for every position. */
  rev: Uint32Array;
}

const tables = new Map<number, Tables>();

function tablesFor(n: number): Tables {
  const cached = tables.get(n);
  if (cached) return cached;

  const half = n >> 1;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);
  for (let i = 0; i < half; i += 1) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }

  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      if (i & (1 << bit)) reversed |= 1 << (bits - 1 - bit);
    }
    rev[i] = reversed;
  }

  const built: Tables = { cos, sin, rev };
  tables.set(n, built);
  return built;
}

/**
 * Forward FFT of `re`/`im`, in place. Length must be a power of two.
 *
 * For real input, pass a zeroed imaginary array; bins `0..n/2` are the useful
 * half, the rest being the conjugate mirror.
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error(`FFT length must be a power of two, got ${n}`);

  const { cos, sin, rev } = tablesFor(n);

  // Reorder into bit-reversed address order so the butterflies below run in place.
  for (let i = 0; i < n; i += 1) {
    const j = rev[i];
    if (j > i) {
      const tempRe = re[i];
      re[i] = re[j];
      re[j] = tempRe;
      const tempIm = im[i];
      im[i] = im[j];
      im[j] = tempIm;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;

    for (let block = 0; block < n; block += size) {
      for (let j = block, k = 0; j < block + half; j += 1, k += step) {
        const partner = j + half;
        const twiddleRe = re[partner] * cos[k] - im[partner] * sin[k];
        const twiddleIm = re[partner] * sin[k] + im[partner] * cos[k];

        re[partner] = re[j] - twiddleRe;
        im[partner] = im[j] - twiddleIm;
        re[j] += twiddleRe;
        im[j] += twiddleIm;
      }
    }
  }
}

/** A periodic Hann window of the given length, for spectral analysis. */
export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return window;
}
