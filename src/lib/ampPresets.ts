/**
 * User-saved amp presets.
 *
 * The factory presets in `lib/ampFx.ts` are starting points and are part of the
 * code. These are the ones someone dialled in themselves, and they belong to the
 * browser, not the build — so they live in `localStorage` behind the same
 * external-store pattern as `lib/theme.ts` and `lib/accent.ts`.
 *
 * That pattern is not a preference. Every route here is prerendered, so reading
 * storage during render makes the first client render disagree with the server
 * HTML, and the repo's lint forbids the usual workaround (`setState` inside an
 * effect). `useSyncExternalStore` is the sanctioned way to read a value React
 * does not own.
 */

import { DEFAULT_AMP, type AmpSettings } from './ampFx';

export interface SavedAmpPreset {
  id: string;
  name: string;
  /** Epoch ms, so the list can be ordered by when it was made. */
  createdAt: number;
  settings: AmpSettings;
}

export const AMP_PRESET_STORAGE_KEY = 'gr-amp-presets';

/** Beyond this the picker stops being a picker. */
export const MAX_SAVED_PRESETS = 24;

const EMPTY: SavedAmpPreset[] = [];

let presets: SavedAmpPreset[] = EMPTY;
let started = false;

const listeners = new Set<() => void>();

/**
 * Accept a stored entry only if it has every field the rack reads.
 *
 * A preset saved by an older build — or hand-edited, or written by a different
 * app on the same origin — would otherwise reach `createAmpChain` and throw while
 * reading `settings.cab.model`, taking the whole rack down. Dropping an
 * unreadable entry loses one preset; not checking loses the page.
 */
function isValid(entry: unknown): entry is SavedAmpPreset {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as Partial<SavedAmpPreset>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return false;
  if (typeof candidate.createdAt !== 'number') return false;

  const settings = candidate.settings as Partial<AmpSettings> | undefined;
  if (!settings || typeof settings !== 'object') return false;

  // Every key the chain destructures, checked by presence rather than by shape:
  // a missing sub-object is the failure that crashes, a wrong number is merely a
  // strange sound.
  for (const key of Object.keys(DEFAULT_AMP) as (keyof AmpSettings)[]) {
    if (settings[key] === undefined) return false;
  }
  return true;
}

function read(): SavedAmpPreset[] {
  try {
    const raw = window.localStorage.getItem(AMP_PRESET_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(isValid).slice(0, MAX_SAVED_PRESETS);
  } catch {
    // Corrupt JSON, storage disabled, private browsing. None is worth an error
    // on a page whose main job is recording audio.
    return EMPTY;
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(AMP_PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Quota or private mode — the presets still work for this session.
  }
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  presets = read();
}

function commit(next: SavedAmpPreset[]): void {
  // A new array every time, because `useSyncExternalStore` compares by
  // reference and mutating in place would not re-render anything.
  presets = next;
  persist();
  listeners.forEach((listener) => listener());
}

export function subscribeAmpPresets(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAmpPresetsSnapshot(): SavedAmpPreset[] {
  start();
  return presets;
}

export function getServerAmpPresetsSnapshot(): SavedAmpPreset[] {
  return EMPTY;
}

/** Trimmed, length-capped, and never empty — an unnamed chip cannot be picked. */
export function normaliseName(name: string, fallback: string): string {
  const trimmed = name.trim().slice(0, 32);
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Save the current settings under a name.
 *
 * Saving over an existing name **replaces** it rather than adding a second entry.
 * Two chips reading "Live" that sound different is the worst outcome here: the
 * user cannot tell them apart without clicking, and clicking changes the sound
 * they were trying to compare against.
 */
export function saveAmpPreset(name: string, settings: AmpSettings): SavedAmpPreset {
  start();
  const finalName = normaliseName(name, `Preset ${presets.length + 1}`);
  const existing = presets.find((preset) => preset.name.toLowerCase() === finalName.toLowerCase());

  const saved: SavedAmpPreset = {
    id: existing?.id ?? `amp-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    name: finalName,
    createdAt: existing?.createdAt ?? Date.now(),
    // Deep-copied through JSON so a later edit of the live settings object cannot
    // reach back into a saved preset. The rack patches with spreads, which copy
    // only the top level.
    settings: JSON.parse(JSON.stringify(settings)) as AmpSettings,
  };

  const next = existing
    ? presets.map((preset) => (preset.id === existing.id ? saved : preset))
    : [...presets, saved].slice(-MAX_SAVED_PRESETS);

  commit(next);
  return saved;
}

export function deleteAmpPreset(id: string): void {
  start();
  commit(presets.filter((preset) => preset.id !== id));
}

export function renameAmpPreset(id: string, name: string): void {
  start();
  const target = presets.find((preset) => preset.id === id);
  if (!target) return;
  commit(
    presets.map((preset) =>
      preset.id === id ? { ...preset, name: normaliseName(name, preset.name) } : preset,
    ),
  );
}

/** Which saved preset the current settings match exactly, if any. */
export function matchingPresetId(
  settings: AmpSettings,
  saved: readonly SavedAmpPreset[],
): string | null {
  const serialised = JSON.stringify(settings);
  return saved.find((preset) => JSON.stringify(preset.settings) === serialised)?.id ?? null;
}
