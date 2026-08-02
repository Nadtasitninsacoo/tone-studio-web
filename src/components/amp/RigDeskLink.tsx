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
 * **It also lets both engines sound at once**, which is the thing it was actually being
 * asked for. Off, listening is exclusive and the handover button moves it; on, the Rig
 * page's monitor and the desk are both live. That is twice the DSP — the cost this whole
 * project spent a day learning — and any instrument live on both sides is heard through two
 * copies of the same processing on two clocks, which comb-filters because two buffers can
 * never be in phase. Both are real, both are the player's to manage by switching a channel
 * off on one side, and neither is a reason to refuse the mode.
 *
 * **One direction for the faders, and that is not an omission.** An instrument has one
 * level; a desk can carry the same rack on several strips. "Which fader sets it" is a
 * question with no correct answer, so the fader half only ever runs Rig → desk.
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
          ? 'บริดจ์เปิด — ทั้งสองหน้าดังพร้อมกัน และระดับ/ปิดช่องที่นี่จะไปเปลี่ยน fader กับ mute บนมิกเซอร์ด้วย · ระวังเสียงซ้อนถ้าช่องเดียวกันสดทั้งสองฝั่ง กดเพื่อปิด'
          : 'บริดจ์ปิด — ฟังได้ทีละฝั่ง และระดับที่นี่คือระดับมอนิเตอร์ ไม่แตะบาลานซ์บนมิกเซอร์ กดเพื่อเปิด'
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
      {/* "บริดจ์: เปิด/ปิด", not "เชื่อม/แยก". The bare state word was read as the action —
          a red button saying "separated from mixer" was taken to mean it had just been
          connected. A label that names the control and then its state cannot be read as
          an instruction. */}
      {linked ? 'บริดจ์ · เปิด' : 'บริดจ์ · ปิด'}
    </button>
  );
}
