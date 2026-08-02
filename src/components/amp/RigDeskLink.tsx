'use client';

import { Link2, Unlink } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import {
  getRigDeskLink,
  getServerRigDeskLink,
  setRigDeskLink,
  subscribeAmp,
} from '@/lib/ampStore';

/**
 * RigDeskLink — the bridge between this row of six and the desk's faders.
 *
 * ---------------------------------------------------------------------------
 * Off, the two are separate jobs: the level here is what you hear *while dialling a tone*,
 * and the desk's fader is where that instrument sits *in the mix*. Only one side owns the
 * live monitor at a time, so the two numbers are never both applied — which is what lets
 * them be independent without ever disagreeing.
 *
 * They were wired together unconditionally at first, and it broke the obvious way to work:
 * shape a tone here, balance it on the desk, come back for one more tweak — and the balance
 * is gone, overwritten by a slider that only ever meant to set a monitor level.
 *
 * On, that same wiring is genuinely useful, which is why this is a switch rather than a
 * deletion: six faders that move the whole desk at once is the fastest way to rough out a
 * balance before touching a single strip.
 *
 * **One direction, and that is not an omission.** An instrument has one level; a desk can
 * carry the same rack on several strips. "Which fader sets it" is a question with no
 * correct answer, so the bridge only ever runs Rig → desk, and the button says so.
 * ---------------------------------------------------------------------------
 */
export function RigDeskLink() {
  const linked = useSyncExternalStore(subscribeAmp, getRigDeskLink, getServerRigDeskLink);

  return (
    <button
      type="button"
      onClick={() => setRigDeskLink(!linked)}
      title={
        linked
          ? 'เชื่อมอยู่ — เลื่อนระดับหรือกดปิดช่องที่นี่ จะไปเปลี่ยน fader และ mute บนมิกเซอร์ด้วย กดเพื่อแยก'
          : 'แยกกันอยู่ — ระดับที่นี่คือระดับมอนิเตอร์ ไม่แตะบาลานซ์บนมิกเซอร์ กดเพื่อเชื่อม'
      }
      aria-pressed={linked}
      className={`flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono text-[9px] font-bold tracking-wider uppercase transition-colors duration-150 ${
        linked
          ? 'border-cyan/50 bg-cyan/12 text-cyan'
          : 'border-line text-ink-3 hover:border-cyan/40 hover:text-ink-2'
      }`}
    >
      {linked ? (
        <Link2 aria-hidden className="h-3 w-3" />
      ) : (
        <Unlink aria-hidden className="h-3 w-3" />
      )}
      {linked ? 'เชื่อมมิกเซอร์' : 'แยกจากมิกเซอร์'}
    </button>
  );
}
