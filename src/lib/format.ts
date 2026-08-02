/**
 * Display formatters. Everything here is deterministic and locale-independent
 * so server-rendered markup matches the client and hydration stays quiet.
 */

function pad(value: number, length = 2): string {
  return Math.floor(Math.abs(value)).toString().padStart(length, '0');
}

/** `HH:MM:SS` — the main transport timecode. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

/**
 * The whole second `formatTimecode` would render for this position.
 *
 * Lives here, beside the formatter, on purpose. Both editor and jam commit their
 * playhead to React state only when this value changes — sixty frames a second
 * become about one render a second — so if this and `formatTimecode` ever disagreed
 * about granularity the readout would visibly stop keeping time.
 */
export function displayedSecond(seconds: number): number {
  return Number.isFinite(seconds) ? Math.floor(Math.max(0, seconds)) : 0;
}

/** Two-digit centiseconds, shown next to the timecode for sub-second feedback. */
export function formatCentiseconds(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return pad(Math.floor((safe % 1) * 100));
}

/** `M:SS` — compact duration for list rows and the player readout. */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${minutes}:${pad(secs)}`;
}

/** Binary file size, e.g. `12.4 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** `19:42:08` — 24h wall clock, matching studio-log conventions. */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `2026-07-26 19:42:08` — full stamp for tooltips. */
export function formatStamp(timestamp: number): string {
  const date = new Date(timestamp);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${formatClock(timestamp)}`;
}

/** Filename-safe stamp: `2026-07-26_19-42-08`. */
export function filenameStamp(timestamp: number): string {
  const date = new Date(timestamp);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** `48000` -> `48.0 kHz`. */
export function formatSampleRate(sampleRate: number): string {
  return `${(sampleRate / 1000).toFixed(1)} kHz`;
}

/** Channel count as a studio label. */
export function formatChannels(channels: number): string {
  if (channels <= 1) return 'MONO';
  if (channels === 2) return 'STEREO';
  return `${channels} CH`;
}
