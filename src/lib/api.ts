/**
 * Client for the NestJS recordings API.
 *
 * Every call degrades gracefully when `NEXT_PUBLIC_API_URL` is unset: the app
 * stays fully usable with session-local takes, it just cannot persist them. That
 * keeps the frontend runnable on its own rather than hard-failing without a server.
 */

import type { Take } from '@/types/recorder';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

/** True when a backend URL is configured, so persistence can be attempted. */
export const isApiConfigured = API_BASE.length > 0;

/**
 * Metadata as returned by `GET /recordings` — no waveform envelope.
 *
 * This and `RemoteRecording` below are a **mirror** of the server's contract, not
 * the source of truth. The API owns those shapes (`RecordingMeta` / `Recording`
 * in its `src/recordings/recording.types.ts`) and the two projects build
 * independently, so nothing here breaks at compile time when the server changes.
 * Keeping them in sync is manual and deliberate: the alternative — a shared
 * package — would couple the build of every client to the server's release.
 */
export interface RemoteRecordingMeta {
  id: string;
  name: string;
  createdAt: number;
  durationSec: number;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
  peakDb: number;
  deviceLabel: string;
}

/** A single take, including its envelope, from `GET /recordings/:id`. */
export interface RemoteRecording extends RemoteRecordingMeta {
  peaks: number[];
}

/** Playback source. Plain URL, so `<audio>` and `<video>` can stream it. */
export function recordingStreamUrl(id: string): string {
  return `${API_BASE}/recordings/${id}/file`;
}

/**
 * Download source.
 *
 * `?download=1` makes the server send `Content-Disposition: attachment`. That is
 * required rather than cosmetic: the HTML `download` attribute is ignored on
 * cross-origin links, so without the header a click would navigate to the audio
 * instead of saving it.
 */
export function recordingDownloadUrl(id: string): string {
  return `${API_BASE}/recordings/${id}/file?download=1`;
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;

  // Surface the server's own message when it sent one — far more useful than
  // "request failed" when the cause is e.g. a rejected sample rate.
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown })?.message;
    if (typeof message === 'string') detail = message;
  } catch {
    // Non-JSON error body — keep the status line.
  }

  throw new Error(`${action} failed: ${detail}`);
}

/** List persisted takes, newest first. Returns [] when no API is configured. */
export async function listRecordings(signal?: AbortSignal): Promise<RemoteRecordingMeta[]> {
  if (!isApiConfigured) return [];

  const response = await fetch(`${API_BASE}/recordings`, { signal });
  await assertOk(response, 'Loading takes');
  return (await response.json()) as RemoteRecordingMeta[];
}

/** Fetch one take including its waveform envelope. */
export async function fetchRecording(
  id: string,
  signal?: AbortSignal,
): Promise<RemoteRecording> {
  const response = await fetch(`${API_BASE}/recordings/${id}`, { signal });
  await assertOk(response, 'Loading take');
  return (await response.json()) as RemoteRecording;
}

/** Upload a freshly captured take. Requires `take.blob`. */
export async function uploadRecording(take: Take): Promise<RemoteRecording> {
  if (!isApiConfigured) throw new Error('No API URL configured.');
  if (!take.blob) throw new Error('This take has no local audio to upload.');

  const body = new FormData();
  body.append('file', take.blob, take.name);
  body.append('name', take.name);
  body.append('createdAt', String(take.createdAt));
  body.append('durationSec', String(take.durationSec));
  body.append('sampleRate', String(take.sampleRate));
  body.append('channels', String(take.channels));
  // The server clamps this to <= 0; -Infinity (pure silence) is not valid JSON.
  body.append('peakDb', String(Number.isFinite(take.peakDb) ? take.peakDb : -200));
  body.append('peaks', JSON.stringify(take.peaks));
  body.append('deviceLabel', take.deviceLabel);

  const response = await fetch(`${API_BASE}/recordings`, { method: 'POST', body });
  await assertOk(response, 'Uploading take');
  return (await response.json()) as RemoteRecording;
}

/** Delete a persisted take. A 404 is treated as success — it is already gone. */
export async function deleteRecording(id: string): Promise<void> {
  if (!isApiConfigured) return;

  const response = await fetch(`${API_BASE}/recordings/${id}`, { method: 'DELETE' });
  if (response.status === 404) return;
  await assertOk(response, 'Deleting take');
}

/** Fetch a persisted take's audio as a Blob, for editing or mixdown. */
export async function fetchRecordingBlob(id: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(recordingStreamUrl(id), { signal });
  await assertOk(response, 'Downloading take');
  return response.blob();
}
