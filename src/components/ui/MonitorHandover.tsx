'use client';

import { Headphones, Volume2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import {
  getMonitorScope,
  getServerMonitorScope,
  setMonitorScope,
  subscribeAmp,
  type MonitorScope,
} from '@/lib/ampStore';

interface MonitorHandoverProps {
  /** Which side this page belongs to. `/` and `/amp` are both `'recorder'`. */
  scope: MonitorScope;
  /** This side's name, for the status line. */
  here: string;
  /** The other side's name, so the button can say where the sound is now. */
  there: string;
}

/**
 * MonitorHandover — the live sound moves when you press this, and at no other time.
 *
 * ---------------------------------------------------------------------------
 * This **replaces** the rule that the page on screen owns the live monitor, and the
 * reasoning for the replacement is worth keeping because the old rule was not wrong.
 *
 * Ownership had to become explicit for two reasons, both of them about the player rather
 * than the audio thread:
 *
 * - **Navigating is not a request to change the sound.** Opening the mixer to look at a
 *   fader silenced the rack you were in the middle of dialling. Coming back re-opened it,
 *   so nothing was lost in the data — but a monitor that cuts out because you glanced at
 *   another page is indistinguishable, in the moment, from one that broke.
 * - **A tone is dialled by ear over minutes.** The settings were always safe in
 *   `lib/ampStore.ts`, but the *ear* is the working state, and it was being reset by a
 *   click on a nav item. That is what "ค่าหาย" meant: not the numbers, the take.
 *
 * What the old rule was protecting is still protected, and by the same mechanism: exactly
 * one side is audible at a time. Two engines running rig chains on one input is double the
 * convolvers and worklets, and three live channels was once enough to overrun the audio
 * thread. Nothing here loosens that — it only moves the decision from the router to a
 * button.
 *
 * The feedback argument survives too, and is if anything stronger. Nothing opens a monitor
 * without a press now, including on `/`, where you arm the input and decide whether the
 * room is safe to open a speaker into.
 *
 * `useSyncExternalStore` needs its third argument here like everywhere else in this app —
 * every route is prerendered, and without a server snapshot `next build` fails on the page
 * with "Missing getServerSnapshot" rather than degrading to client rendering.
 * ---------------------------------------------------------------------------
 */
export function MonitorHandover({ scope, here, there }: MonitorHandoverProps) {
  const owner = useSyncExternalStore(subscribeAmp, getMonitorScope, getServerMonitorScope);
  const owns = owner === scope;

  if (owns) {
    return (
      <span
        role="status"
        title={`เสียงสดอยู่ที่${here} — จะไม่ย้ายไปไหนจนกว่าจะกดปุ่มที่หน้าอื่น`}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-cyan/50 bg-cyan/12 px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase text-cyan"
      >
        <Volume2 aria-hidden className="h-3.5 w-3.5" />
        เสียงสดอยู่ที่นี่
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setMonitorScope(scope)}
      title={`ตอนนี้เสียงสดอยู่ที่${there} — กดเพื่อย้ายมาที่${here}`}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-inset px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase text-ink-2 transition-colors duration-150 hover:border-cyan/50 hover:text-cyan"
    >
      <Headphones aria-hidden className="h-3.5 w-3.5" />
      รับเสียงมาที่นี่
    </button>
  );
}
