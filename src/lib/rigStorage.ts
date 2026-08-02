/**
 * The whole rig, kept deliberately.
 *
 * ---------------------------------------------------------------------------
 * `lib/ampStore.ts` says why it does **not** persist by itself, and that rule stands: a
 * knob drag fires a change every frame, so writing storage on each one would hammer it for
 * a value nobody asked to keep, and it would quietly compete with the tone the player
 * saved on purpose. Automatic persistence is the wrong answer.
 *
 * A button is the right one. This is what it writes: all six racks in one object, under one
 * key, at one moment the player chose. Six separate saves would let them drift — a guitar
 * from this session beside a bass from last week is a rig nobody ever dialled.
 *
 * **Everything read back is clamped.** Storage is untrusted input in exactly the sense
 * `lib/ampSchema.ts` means it: the file can be edited by hand, written by an older build
 * with a different shape, or corrupted halfway through a write. The clamps are total —
 * they never throw, never return a partial object, and fall back per field — so a bad key
 * costs the fields that were bad and nothing else. Nothing reaches `createAmpChain`
 * unclamped, which is the boundary the whole schema module exists to hold.
 *
 * **Not the server, and this is a choice rather than an omission.** The API in
 * `lib/api.ts` owns takes, its contract is owned by the server repository, and the app is
 * required to stay fully usable with `NEXT_PUBLIC_API_URL` unset. A tone that only
 * survives a refresh when a server happens to be up is a worse promise than one that
 * always does. When rigs do want to follow a player between machines, this is the shape
 * that gets sent — one object, already validated.
 * ---------------------------------------------------------------------------
 */

import { DEFAULT_RIG, type RigSettings } from './rig';
import { clampAmp } from './ampSchema';
import { clampBass, clampBrass, clampDrums, clampKeys, clampVocals } from './rigSchema';

/**
 * Versioned, so a future shape change can be ignored rather than half-read.
 *
 * A stored rig that does not match is dropped and the defaults are used. That is a real
 * loss of someone's settings, which is why the version only moves when the alternative is
 * loading something that no longer means what it says.
 */
export const RIG_STORAGE_KEY = 'tone-studio-rig-v1';

/** What `loadRig` reports, so the UI can say "restored" rather than guess. */
export interface StoredRig {
  rig: RigSettings;
  /** Epoch milliseconds at the moment it was saved. */
  savedAt: number;
}

/** Validate an unknown blob into a rig. Total: every field falls back to the default. */
function clampRig(input: unknown): RigSettings {
  const raw = (input ?? {}) as Partial<Record<keyof RigSettings, unknown>>;
  return {
    guitar: clampAmp(raw.guitar, DEFAULT_RIG.guitar),
    bass: clampBass(raw.bass, DEFAULT_RIG.bass),
    drums: clampDrums(raw.drums, DEFAULT_RIG.drums),
    vocals: clampVocals(raw.vocals, DEFAULT_RIG.vocals),
    keys: clampKeys(raw.keys, DEFAULT_RIG.keys),
    brass: clampBrass(raw.brass, DEFAULT_RIG.brass),
  };
}

/** Write all six racks. Returns false when storage refused — private mode, or full. */
export function saveRig(rig: RigSettings, savedAt: number): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(RIG_STORAGE_KEY, JSON.stringify({ rig, savedAt }));
    return true;
  } catch {
    // Quota, or a browser with storage disabled. The session keeps its tone either way,
    // and the button reports the failure rather than claiming a save that did not happen.
    return false;
  }
}

/**
 * Read the saved rig, or null when there is none.
 *
 * **Must not be called during render.** Every route here is prerendered, and a value that
 * exists on the client and not on the server is a hydration mismatch — the same reason
 * `lib/theme.ts` reads its storage in an effect. Call it after mount and push the result
 * into the store.
 */
export function loadRig(): StoredRig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rig?: unknown; savedAt?: unknown };
    return {
      rig: clampRig(parsed?.rig),
      savedAt: typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    // Unparseable. Treated as absent rather than as an error: the defaults are a working
    // rig, and refusing to start over a bad storage key would be the worse failure.
    return null;
  }
}

/** Forget the saved rig. The session keeps whatever is dialled. */
export function clearRig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RIG_STORAGE_KEY);
  } catch {
    // Nothing to do, and nothing depends on it having worked.
  }
}
