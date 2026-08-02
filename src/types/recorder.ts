/**
 * Shared domain types for the Tone Studio dashboard.
 * Kept framework-agnostic so the NestJS backend can reuse the shapes later.
 */

/** Transport state machine for the recording engine. */
export type RecorderStatus =
  | 'idle' // no input stream open
  | 'arming' // opening the device / loading the worklet
  | 'ready' // stream live, meters running, not capturing
  | 'recording' // capturing to buffer
  | 'paused' // capture suspended, buffer retained
  /**
   * The device dropped out and is being reopened.
   *
   * Distinct from `error` because nothing is broken and nothing needs pressing:
   * the graph is intact, the amp is still dialled, and `lib/inputSession` is
   * working through its backoff. Collapsing it into `error` is what made a 40 ms
   * USB glitch look like the end of the session.
   */
  | 'recovering'
  | 'error'; // device or engine failure, out of automatic options

/** Microphone/line-in permission state as reported by the browser. */
export type DevicePermission = 'unknown' | 'prompt' | 'granted' | 'denied';

/** A selectable audio input, normalised from `MediaDeviceInfo`. */
export interface InputDevice {
  deviceId: string;
  /** Human label. Empty until permission is granted, so we fall back to a stub. */
  label: string;
  groupId: string;
  /** Heuristic: looks like an external USB interface / multi-FX pedal. */
  isInterface: boolean;
  /** Heuristic: matches the M-VAVE Tank-G specifically. */
  isTankG: boolean;
  /**
   * Heuristic: a Bluetooth headset-profile endpoint.
   *
   * These exist as recording devices but only carry telephone-bandwidth mono
   * (8–16 kHz), because Bluetooth's high-quality profile (A2DP) is output-only.
   * Flagged so the UI can warn instead of silently capturing unusable audio.
   */
  isBluetooth: boolean;
}

/** Live meter snapshot, written every animation frame by the engine. */
export interface MeterSnapshot {
  /** Instantaneous peak per channel, 0..1 linear amplitude. */
  peak: number[];
  /** Smoothed RMS per channel, 0..1 linear amplitude. */
  rms: number[];
  /** Decaying peak-hold marker per channel, 0..1 linear amplitude. */
  hold: number[];
  /** True while the input has clipped within the hold window. */
  clipped: boolean;
}

/**
 * Latest pitch reading, written by the engine at the detector's own rate.
 *
 * Mutated in place like `MeterSnapshot`, for the same reason: the needle moves
 * continuously and routing it through React state would re-render the dashboard
 * on every reading.
 */
export interface TunerSnapshot {
  /** Detected fundamental in Hz, or 0 when nothing is being played. */
  hz: number;
  /** How periodic the window was, 0..1. Below ~0.9 it is a chord or noise. */
  clarity: number;
  /** RMS of the analysed window, 0..1 linear. Drives the "play a string" prompt. */
  rms: number;
  /**
   * `performance.now()` of the last successful detection.
   *
   * The reading is held rather than blanked the moment a note decays: a needle
   * that vanishes between plucks is unusable, because tuning *is* the act of
   * turning a peg after the note has died away.
   */
  at: number;
}

/** Technical properties of the open input stream. */
export interface StreamFormat {
  sampleRate: number;
  channels: number;
  /** We always write 16-bit PCM WAV. */
  bitDepth: 16;
}

/** Whether a take has made it to the server yet. */
export type SyncState = 'local' | 'uploading' | 'synced' | 'failed';

/** A finished recording. */
export interface Take {
  id: string;
  /** Suggested filename, e.g. `take-03_2026-07-26_19-42-08.wav`. */
  name: string;
  /** Epoch ms the take was finalised. */
  createdAt: number;
  durationSec: number;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
  /** Highest sample magnitude in the take, as dBFS (<= 0). */
  peakDb: number;
  /** Downsampled envelope for waveform rendering, 0..1 per bucket. */
  peaks: number[];
  /**
   * Local audio. Present for takes captured this session, absent for takes
   * loaded back from the API — those stream from the server instead.
   */
  blob?: Blob;
  /** Playback source: an object URL locally, or the API stream URL once persisted. */
  url: string;
  /**
   * Download source. Separate from `url` because a cross-origin API take needs
   * `?download=1` (the server sets Content-Disposition) — the HTML `download`
   * attribute is ignored cross-origin.
   */
  downloadUrl: string;
  /** Device the take was captured from, for the history list. */
  deviceLabel: string;
  /** Persistence state, surfaced in the history list. */
  sync: SyncState;
  /**
   * Server-side id once uploaded. Kept separate from `id` so that persisting a
   * take never changes its React key — otherwise the selected take would jump
   * and the player would remount the moment an upload completed.
   */
  remoteId?: string;
}
