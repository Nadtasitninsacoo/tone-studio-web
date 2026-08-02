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
      /*
       * Loud on purpose, and red **against** this app's own convention.
       *
       * The rule everywhere else here is that red means live or broken, and `separated` is
       * neither — it is the recommended default. It is red because the first two versions
       * could not be found at all: 24px of grey text beside a grey label reads as part of
       * the label. Asked for explicitly, and easy to move to amber (which is what LIGHT
       * mode uses for "deliberate, not wrong") if it ever starts reading as a fault.
       */
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase transition-colors duration-150 ${
        linked
          ? 'border-cyan/60 bg-cyan/15 text-cyan shadow-sm shadow-cyan/15'
          : 'border-rec bg-rec/25 text-rec shadow-md shadow-rec/25 hover:bg-rec/40 hover:text-white'
      }`}
    >
      {linked ? (
        <Link2 aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <Unlink aria-hidden className="h-3.5 w-3.5" />
      )}
      {linked ? 'เชื่อมมิกเซอร์' : 'แยกจากมิกเซอร์'}
    </button>
  );
}
