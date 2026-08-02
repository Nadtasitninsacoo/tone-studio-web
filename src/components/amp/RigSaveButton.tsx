'use client';

import { Check, Save, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { getRigSnapshot, getServerRigSnapshot, subscribeAmp } from '@/lib/ampStore';
import { saveRig } from '@/lib/rigStorage';

/** How long the confirmation stays up. Long enough to read, short enough not to nag. */
const CONFIRM_MS = 2200;

/**
 * RigSaveButton — one press, all six racks kept.
 *
 * ---------------------------------------------------------------------------
 * The rig store deliberately does not persist itself: a knob drag writes every frame, and
 * automatic storage would both hammer it and quietly compete with the tone the player kept
 * on purpose. The answer to "my settings vanish when I refresh" is therefore a button, not
 * a listener — and this is it.
 *
 * **One button for all six, not six buttons.** The racks are dialled against each other:
 * a bass level is chosen to sit under a guitar, a drum bus against both. Saving them
 * separately lets them drift out of the arrangement they were balanced in, and restoring a
 * guitar from tonight beside a bass from last week is a rig nobody ever heard.
 *
 * It is deliberately **not** the same thing as `SAVE CURRENT` in the rack below, and the
 * distinction is worth keeping: that saves a *named guitar preset* to come back to, this
 * keeps *the desk as it stands* so tomorrow starts where tonight ended. One is a library,
 * the other is a session.
 *
 * The dirty mark compares against what was last written, so it means "there is something
 * unsaved here" rather than "you have touched something". Nothing warns on navigation — the
 * engines live above the router and the tone survives it, so a page change is not a risk
 * and a dialog there would be a lie.
 * ---------------------------------------------------------------------------
 */
export function RigSaveButton() {
  const rig = useSyncExternalStore(subscribeAmp, getRigSnapshot, getServerRigSnapshot);
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  /**
   * The rig as it was last written, by identity.
   *
   * The store hands back the same object until something changes it, so an identity
   * comparison is exactly "has anything moved since the save" — no deep compare, and no
   * false dirty mark from a re-render.
   */
  const savedRef = useRef<unknown>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setIsDirty(savedRef.current !== null && savedRef.current !== rig);
  }, [rig]);

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const onSave = () => {
    // `Date.now()` at the moment of the press, not at render: the stamp records when the
    // rig was kept, and a value read during render would be whenever React last painted.
    const ok = saveRig(rig, Date.now());
    savedRef.current = ok ? rig : savedRef.current;
    setIsDirty(false);
    setState(ok ? 'saved' : 'failed');
  };

  const Icon = state === 'saved' ? Check : state === 'failed' ? TriangleAlert : Save;

  return (
    <button
      type="button"
      onClick={onSave}
      title="บันทึกค่าแร็คทั้ง 6 ตัวไว้ในเครื่อง — รีเฟรชแล้วจะกลับมาเหมือนเดิม"
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase transition-colors duration-150 ${
        state === 'saved'
          ? 'border-green/60 bg-green/12 text-green'
          : state === 'failed'
            ? 'border-rec/60 bg-rec/12 text-rec'
            : isDirty
              ? 'border-amber/60 bg-amber/12 text-amber'
              : 'border-line-strong bg-inset text-ink-2 hover:border-cyan/50 hover:text-cyan'
      }`}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {state === 'saved'
        ? 'บันทึกแล้ว'
        : state === 'failed'
          ? 'บันทึกไม่ได้'
          : isDirty
            ? 'บันทึกค่า •'
            : 'บันทึกค่า'}
    </button>
  );
}
