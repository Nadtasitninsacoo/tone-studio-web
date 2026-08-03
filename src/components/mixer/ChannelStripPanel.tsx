'use client';

import { Activity, RotateCcw, Timer, Waves } from 'lucide-react';

import { MiniSlider } from '@/components/ui/Controls';
import {
  DEFAULT_STRIP,
  isStripActive,
  STRIP_RANGES,
  type ChannelStrip,
} from '@/lib/channelStrip';
import type { MixerChannel } from '@/types/mixer';

/**
 * ChannelStripPanel — polarity, low cut, EQ, compressor and alignment, for **one**
 * channel at a time.
 *
 * ---------------------------------------------------------------------------
 * Why one panel and not a section on every strip.
 *
 * Thirteen controls on eight strips is a hundred and four controls on one screen,
 * and the desk is already the densest page in the app. Every large digital console
 * answers this the same way and has for thirty years: the strips carry level, pan
 * and routing, and a **selected-channel section** carries the shaping — you press a
 * strip, and this becomes that channel.
 *
 * The alternative was tried in miniature one screen over. `RigMixer`'s six channels
 * were widened to hold a fader each, and the measurement was that a control needs
 * either room or a place to be somewhere else; there is no third option that is not
 * simply cramped.
 *
 * It also matches how the work will grow. Aux sends, a second EQ, a gate on the
 * channels that get one — every future addition lands here, on the channel in
 * front of you, rather than multiplying by eight.
 * ---------------------------------------------------------------------------
 */

interface ChannelStripPanelProps {
  channel: MixerChannel | null;
  onChange: (patch: Partial<ChannelStrip>) => void;
}

/** One labelled control, sized so a row of them lines up whatever the label says. */
function Cell({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-baseline justify-between gap-1">
        <span className="truncate font-mono text-[8px] tracking-[0.12em] uppercase text-ink-3">
          {label}
        </span>
        <span className="shrink-0 font-mono text-[9px] tabular-nums text-ink-2">{value}</span>
      </span>
      {children}
    </label>
  );
}

function Section({
  icon,
  title,
  hint,
  on,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  /** `null` for a section with nothing to switch — the EQ is always in the path. */
  on: boolean | null;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border border-line bg-base p-2">
      <header className="flex items-center gap-1.5">
        <span className="text-ink-3">{icon}</span>
        <h4 className="flex-1 font-mono text-[9px] font-bold tracking-[0.14em] uppercase text-ink-2">
          {title}
        </h4>
        {on === null ? null : (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={on}
            title={hint}
            className={`rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider uppercase transition-colors duration-200 ${
              on
                ? 'border-cyan/60 bg-cyan/15 text-cyan'
                : 'border-line text-ink-3 hover:text-ink'
            }`}
          >
            {on ? 'ON' : 'OFF'}
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

const hz = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`);
const db = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

export function ChannelStripPanel({ channel, onChange }: ChannelStripPanelProps) {
  if (!channel) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-[11px] text-ink-3">
        <Waves aria-hidden className="h-3.5 w-3.5 shrink-0" />
        เลือกช่องบนโต๊ะเพื่อปรับ EQ, คอมเพรสเซอร์ และการจูนเฟสของช่องนั้น
      </div>
    );
  }

  const strip = channel.strip;
  const patchEq = (patch: Partial<ChannelStrip['eq']>) => onChange({ eq: { ...strip.eq, ...patch } });

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 shadow-panel">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase text-ink">
          Channel strip
        </h3>
        <span className="truncate rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[9px] text-ink-2">
          {channel.name}
        </span>
        {isStripActive(strip) ? (
          <span className="rounded border border-cyan/50 bg-cyan/10 px-1.5 py-0.5 font-mono text-[8px] tracking-wider uppercase text-cyan">
            active
          </span>
        ) : null}
        <span className="flex-1" />
        {/* Polarity is a switch and not a knob because it has two states and no
            in-between. It sits in the header rather than in a section of its own:
            it is one bit, before everything, and giving it a panel would say it was
            comparable in size to the EQ. */}
        <button
          type="button"
          onClick={() => onChange({ invert: !strip.invert })}
          aria-pressed={strip.invert}
          title="กลับเฟส 180° — สำหรับไมค์หลายตัวบนแหล่งเสียงเดียวที่หักล้างกัน"
          className={`flex h-6 items-center gap-1 rounded border px-2 font-mono text-[9px] font-bold transition-colors duration-200 ${
            strip.invert
              ? 'border-amber/60 bg-amber/15 text-amber'
              : 'border-line text-ink-3 hover:text-ink'
          }`}
        >
          Ø
        </button>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_STRIP)}
          title="คืนค่าช่องนี้ทั้งหมด"
          className="flex h-6 w-6 items-center justify-center rounded border border-line text-ink-3 transition-colors duration-200 hover:text-ink"
        >
          <RotateCcw aria-hidden className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        {/* ---- Low cut ------------------------------------------------------
            Its own section rather than a fifth EQ band: it is the one filter on a
            live channel that is reached for every time, and it is a corner rather
            than a gain — nothing else here is set in Hz alone. */}
        <Section
          icon={<Waves aria-hidden className="h-3 w-3" />}
          title="Low cut"
          hint="ตัดเสียงสั่นสะเทือนและลมใต้เสียงจริง"
          on={strip.hpf.enabled}
          onToggle={() => onChange({ hpf: { ...strip.hpf, enabled: !strip.hpf.enabled } })}
        >
          <Cell label="Corner" value={`${hz(strip.hpf.hz)} Hz`}>
            <MiniSlider
              label=""
              value={strip.hpf.hz}
              min={STRIP_RANGES.hpfHz[0]}
              max={STRIP_RANGES.hpfHz[1]}
              step={1}
              disabled={!strip.hpf.enabled}
              onChange={(value) => onChange({ hpf: { ...strip.hpf, hz: value } })}
            />
          </Cell>
          <Cell label="Align" value={`${strip.delayMs.toFixed(1)} ms`}>
            <MiniSlider
              label=""
              value={strip.delayMs}
              min={STRIP_RANGES.delayMs[0]}
              max={STRIP_RANGES.delayMs[1]}
              step={0.1}
              onChange={(value) => onChange({ delayMs: value })}
            />
          </Cell>
          <p className="font-mono text-[8px] leading-tight text-ink-3/70">
            หน่วง 1 ms ≈ ไมค์ห่างขึ้น 34 ซม. — ใช้จูนเฟสไมค์หลายตัว ไม่ใช่เอฟเฟกต์
          </p>
        </Section>

        {/* ---- EQ ------------------------------------------------------------
            No switch: four bands at 0 dB are already a bypass, so offering one
            would be a control that changes nothing. Same reading the amp's tone
            stack gets in `ampGraph`. */}
        <Section
          icon={<Activity aria-hidden className="h-3 w-3" />}
          title="EQ"
          hint=""
          on={null}
        >
          <div className="flex gap-1.5">
            <Cell label="Low" value={db(strip.eq.lowDb)}>
              <MiniSlider
                label=""
                value={strip.eq.lowDb}
                min={STRIP_RANGES.lowDb[0]}
                max={STRIP_RANGES.lowDb[1]}
                step={0.5}
                onChange={(value) => patchEq({ lowDb: value })}
              />
            </Cell>
            <Cell label="High" value={db(strip.eq.highDb)}>
              <MiniSlider
                label=""
                value={strip.eq.highDb}
                min={STRIP_RANGES.highDb[0]}
                max={STRIP_RANGES.highDb[1]}
                step={0.5}
                onChange={(value) => patchEq({ highDb: value })}
              />
            </Cell>
          </div>

          {/* The two mids each get a gain and a frequency, because a mid whose
              frequency you cannot move is a guess about where the problem is — and
              on a live channel the problem moves with the room, the mic and the
              player. */}
          <div className="flex gap-1.5">
            <Cell label="Lo-mid" value={db(strip.eq.lowMidDb)}>
              <MiniSlider
                label=""
                value={strip.eq.lowMidDb}
                min={STRIP_RANGES.lowMidDb[0]}
                max={STRIP_RANGES.lowMidDb[1]}
                step={0.5}
                onChange={(value) => patchEq({ lowMidDb: value })}
              />
            </Cell>
            <Cell label="at" value={`${hz(strip.eq.lowMidHz)} Hz`}>
              <MiniSlider
                label=""
                value={strip.eq.lowMidHz}
                min={STRIP_RANGES.lowMidHz[0]}
                max={STRIP_RANGES.lowMidHz[1]}
                step={5}
                onChange={(value) => patchEq({ lowMidHz: value })}
              />
            </Cell>
          </div>
          <div className="flex gap-1.5">
            <Cell label="Hi-mid" value={db(strip.eq.highMidDb)}>
              <MiniSlider
                label=""
                value={strip.eq.highMidDb}
                min={STRIP_RANGES.highMidDb[0]}
                max={STRIP_RANGES.highMidDb[1]}
                step={0.5}
                onChange={(value) => patchEq({ highMidDb: value })}
              />
            </Cell>
            <Cell label="at" value={`${hz(strip.eq.highMidHz)} Hz`}>
              <MiniSlider
                label=""
                value={strip.eq.highMidHz}
                min={STRIP_RANGES.highMidHz[0]}
                max={STRIP_RANGES.highMidHz[1]}
                step={25}
                onChange={(value) => patchEq({ highMidHz: value })}
              />
            </Cell>
          </div>
        </Section>

        {/* ---- Compressor ---------------------------------------------------- */}
        <Section
          icon={<Timer aria-hidden className="h-3 w-3" />}
          title="Compressor"
          hint="คุมช่วงไดนามิกของช่องนี้"
          on={strip.comp.enabled}
          onToggle={() => onChange({ comp: { ...strip.comp, enabled: !strip.comp.enabled } })}
        >
          <div className="flex gap-1.5">
            <Cell label="Thresh" value={`${strip.comp.thresholdDb.toFixed(0)} dB`}>
              <MiniSlider
                label=""
                value={strip.comp.thresholdDb}
                min={STRIP_RANGES.thresholdDb[0]}
                max={STRIP_RANGES.thresholdDb[1]}
                step={1}
                disabled={!strip.comp.enabled}
                onChange={(value) => onChange({ comp: { ...strip.comp, thresholdDb: value } })}
              />
            </Cell>
            <Cell label="Ratio" value={`${strip.comp.ratio.toFixed(1)}:1`}>
              <MiniSlider
                label=""
                value={strip.comp.ratio}
                min={STRIP_RANGES.ratio[0]}
                max={STRIP_RANGES.ratio[1]}
                step={0.1}
                disabled={!strip.comp.enabled}
                onChange={(value) => onChange({ comp: { ...strip.comp, ratio: value } })}
              />
            </Cell>
          </div>
          <div className="flex gap-1.5">
            <Cell label="Attack" value={`${Math.round(strip.comp.attack * 1000)} ms`}>
              <MiniSlider
                label=""
                value={strip.comp.attack}
                min={STRIP_RANGES.attack[0]}
                max={STRIP_RANGES.attack[1]}
                step={0.001}
                disabled={!strip.comp.enabled}
                onChange={(value) => onChange({ comp: { ...strip.comp, attack: value } })}
              />
            </Cell>
            <Cell label="Release" value={`${Math.round(strip.comp.release * 1000)} ms`}>
              <MiniSlider
                label=""
                value={strip.comp.release}
                min={STRIP_RANGES.release[0]}
                max={STRIP_RANGES.release[1]}
                step={0.01}
                disabled={!strip.comp.enabled}
                onChange={(value) => onChange({ comp: { ...strip.comp, release: value } })}
              />
            </Cell>
          </div>
          <p className="font-mono text-[8px] leading-tight text-ink-3/70">
            ไม่มีเกตในช่อง — แร็กที่ต้องใช้เกต (กลอง, ร้อง) มีเกตของตัวเองอยู่แล้ว
          </p>
        </Section>
      </div>
    </div>
  );
}
