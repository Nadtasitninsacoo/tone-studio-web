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
 * **It also decides which end of the chain reaches the room**, and that is standard gain
 * structure rather than a preference: instrument → rack → console → speakers, one path,
 * with the console at the end holding the level.
 *
 * Bridged, the desk is that console and this page is the stage in front of it — set the
 * racks for a good level and leave them, then ride the mix on the desk. This engine's own
 * monitor bus closes, because its racks are already inside the desk and leaving it open put
 * the same instrument into the room twice: two copies of one processing chain on two clocks
 * that can never be in phase, twice the DSP, and a desk fader that could only pull down
 * half of what you could hear. That was tried and it is what this replaced.
 *
 * Unbridged, there is no console in the chain, and this page's monitor is the shortest path
 * from string to speaker — which is what you want while dialling one instrument.
 *
 * **The faders link both ways**, and getting there took a correction. It ran Rig → desk
 * only, on the reasoning that a rack can sit on several strips so "which fader sets it"
 * had no answer. With both engines audible that made a desk fader control half of what
 * could be heard — pulled to the bottom, the Rig monitor carried on playing that
 * instrument at full, which reads as a fader that does not work. The question does have an
 * answer: **the fader that was just moved.** Two strips carrying one rack now behave like
 * two faders on one bus, last touch wins.
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
          ? 'บริดจ์เปิด — เสียงออกทางมิกเซอร์ แร็คที่นี่เป็นต้นทางป้อนเข้าไป (เร่งให้ได้เกนที่ดี) ส่วนระดับในมิกซ์คุมที่ fader ของ desk · ระดับกับ mute เชื่อมกันสองทาง กดเพื่อปิด'
          : 'บริดจ์ปิด — desk พัก เสียงออกทางหน้า Rig โดยตรง latency ต่ำสุด สำหรับปั้นโทนทีละเครื่อง กดเพื่อส่งเข้ามิกเซอร์'
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
