'use client';

import { SignalBoard } from '@/components/board/SignalBoard';
import type { AmpSettings } from '@/lib/ampFx';
import { ampGraph, type AmpNodeId } from '@/lib/ampGraph';

interface AmpBoardProps {
  amp: AmpSettings;
  onChange: (amp: AmpSettings) => void;
}

/**
 * The settings key each switchable node toggles.
 *
 * `tone`, `dry` and `out` are absent on purpose: the tone stack has no enable flag
 * (three filters at 0 dB are already a bypass), and the other two are not effects.
 */
const TOGGLE_KEY = {
  gate: 'gate',
  comp: 'comp',
  drive: 'drive',
  cab: 'cab',
  delay: 'delay',
  reverb: 'reverb',
  limiter: 'limiter',
} as const satisfies Partial<Record<AmpNodeId, keyof AmpSettings>>;

type ToggleableId = keyof typeof TOGGLE_KEY;

/**
 * AmpBoard — the amp drawn as signal flow, above the knobs.
 *
 * Worth having next to `AmpRack` rather than instead of it: the rack groups fifteen
 * controls into three blocks by *function*, and the two facts that most often get
 * misread are about *order* — the tone stack sits before the drive, and the output
 * trim sits before the limiter. Neither is visible in a grid of knobs. See
 * `lib/ampGraph`.
 */
export function AmpBoard({ amp, onChange }: AmpBoardProps) {
  const toggle = (id: string) => {
    const key = TOGGLE_KEY[id as ToggleableId];
    if (!key) return;
    const stage = amp[key];
    onChange({ ...amp, [key]: { ...stage, enabled: !stage.enabled } });
  };

  return <SignalBoard graph={ampGraph(amp)} title="Signal flow" onToggle={toggle} />;
}
