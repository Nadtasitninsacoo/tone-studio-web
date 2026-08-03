'use client';

import { Drum, Guitar, Power, Waves, Mic, Keyboard, Wind, type LucideIcon } from 'lucide-react';

import { MiniSlider } from '@/components/ui/Controls';
import { INSTRUMENT_INFO, INSTRUMENTS, type Instrument } from '@/lib/rig';
import { RigDeskLink } from './RigDeskLink';
import { usePressAndHold } from '@/hooks/usePressAndHold';

const ICONS: Record<Instrument, LucideIcon> = {
  guitar: Guitar,
  bass: Waves,
  drums: Drum,
  vocals: Mic,
  keys: Keyboard,
  brass: Wind,
};

interface RigMixerProps {
  /** Which rack is on screen. Highlighted here, but not tied to what is heard. */
  instrument: Instrument;
  onSelect: (instrument: Instrument) => void;
  enabled: Record<Instrument, boolean>;
  onToggle: (instrument: Instrument) => void;
  level: Record<Instrument, number>;
  onLevel: (instrument: Instrument, value: number) => void;
  accent: string;
  /** False until an input is armed — nothing here makes a sound without one. */
  isArmed: boolean;
  /**
   * Which mixer channels carry each rack, and how to put the live input on one.
   *
   * This is the answer to "I turn these knobs and nothing happens". A rack only changes
   * what you hear if some channel is *playing something through it*, and until this row
   * said so, the only way to find out was to guess. Optional so the component still
   * renders without the mixer.
   */
  channelsFor?: (instrument: Instrument) => { id: string; name: string; source: { kind: string } }[];
  onPutLive?: (instrument: Instrument) => void;
  /**
   * Whether the input is arriving at these racks through *this* engine right now.
   *
   * The row above answers "will my knobs do anything", and while this page owns the live
   * monitor the answer is yes regardless of what the desk holds — the signal is coming
   * straight off the input. Reporting an empty mixer channel in that state printed
   * "ไม่มีสัญญาณ" a few centimetres from meters reading −1.6 dBFS, which is not a
   * confusing message, it is a false one.
   */
  hasLiveFeed?: boolean;
}

/**
 * RigMixer — the bridge between the studio racks.
 */
export function RigMixer({
  instrument,
  onSelect,
  enabled,
  onToggle,
  level,
  onLevel,
  accent,
  isArmed,
  channelsFor,
  onPutLive,
  hasLiveFeed = false,
}: RigMixerProps) {
  const liveCount = INSTRUMENTS.filter((id) => enabled[id]).length;

  return (
    <section className="rounded-xl border border-line bg-panel p-1.5 shadow-panel">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[9px] font-semibold tracking-[0.16em] uppercase text-ink-3">
            Rig mixer
          </p>
          {/* Whether this row also drives the desk. Off by default — see `RigDeskLink`. */}
          <RigDeskLink />
        </div>
        <p className="font-mono text-[9px] tracking-wider uppercase text-ink-3">
          {liveCount === 0
            ? 'ทุกช่องปิด — ได้ยินสัญญาณดิบ'
            : `${liveCount} ช่องเปิดพร้อมกัน`}
        </p>
      </div>

      {/* Strips are a **fixed width**, packed and centred — not a grid stretched
          across the bar.

          The first upright pass kept the six-column grid, which on a wide screen
          gave every channel a ~300px cell holding a 20px fader: the control hugged
          the left edge, the readout sat at the far right, and a quarter of a metre
          of nothing lay between them. Stretching is right for a horizontal fader,
          whose length *is* the control, and wrong for a vertical one, whose length
          is its height.

          A console strip has a width, and it is narrow. `flex-wrap` means eight or
          sixteen of them will simply flow onto another line when they arrive. */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {INSTRUMENTS.map((id) => (
          <MixerChannel
            key={id}
            id={id}
            isShown={instrument === id}
            isOn={enabled[id]}
            accent={accent}
            isArmed={isArmed}
            level={level[id]}
            onToggle={onToggle}
            onSelect={onSelect}
            onLevel={onLevel}
            channels={channelsFor?.(id) ?? []}
            onPutLive={onPutLive}
            hasLiveFeed={hasLiveFeed}
          />
        ))}
      </div>
    </section>
  );
}

interface MixerChannelProps {
  id: Instrument;
  isShown: boolean;
  isOn: boolean;
  accent: string;
  isArmed: boolean;
  level: number;
  onToggle: (instrument: Instrument) => void;
  onSelect: (instrument: Instrument) => void;
  onLevel: (instrument: Instrument, value: number) => void;
  channels: { id: string; name: string; source: { kind: string } }[];
  onPutLive?: (instrument: Instrument) => void;
  hasLiveFeed: boolean;
}

function MixerChannel({
  id,
  isShown,
  isOn,
  accent,
  isArmed,
  level,
  onToggle,
  onSelect,
  onLevel,
  channels,
  onPutLive,
  hasLiveFeed,
}: MixerChannelProps) {
  const info = INSTRUMENT_INFO[id];
  const Icon = ICONS[id];

  /**
   * Where this rack lands on the desk.
   *
   * `playing` is the only state that matters for "will my knobs do anything": a channel
   * that carries the rack but holds no source is a knob acting on silence.
   */
  const playing = channels.filter((channel) => channel.source.kind !== 'empty');
  const carrier = playing[0] ?? channels[0] ?? null;

  const decrementHandlers = usePressAndHold(() => {
    onLevel(id, Math.max(0, level - 0.01));
  });

  const incrementHandlers = usePressAndHold(() => {
    onLevel(id, Math.min(1.5, level + 0.01));
  });

  return (
    <div
      className="flex flex-col gap-1 rounded-lg border px-2 py-1.5 transition-colors duration-200"
      style={
        isShown
          ? {
              borderColor: accent,
              backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
            }
          : { borderColor: 'transparent' }
      }
    >
      {/* ---- Row 1: what it is, and whether you hear it ------------------------
          Fixed height, like row two. The six strips carry different amounts of
          text — "V-TONE" against "สัญญาณสด · BREAK ว่าง" — and letting each size
          itself put six faders at six different heights, which is what made the
          row read as accidental rather than built. */}
      <div className="flex h-4 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSelect(id)}
          title={`แสดงแร็ค${info.label} — ${info.hint}`}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <Icon aria-hidden className="h-3 w-3 shrink-0 text-ink-3" />
          <span
            className={`truncate text-[11px] leading-none font-semibold ${
              isOn ? 'text-ink' : 'text-ink-3'
            }`}
          >
            {info.label}
          </span>
        </button>

        {/* Value and switch together, right-aligned on every strip, so the eye
            finds them in the same place on all six rather than wherever that
            channel's name happened to end.

            The switch stays mounted and merely disabled when the channel is off,
            for the same reason the fader does: a control that disappears takes its
            value's visibility with it, and the value is what you set before
            switching the channel off. */}
        <span
          className={`shrink-0 font-mono text-[10px] tabular-nums select-none transition-colors duration-150 ${
            isOn ? 'text-ink-2' : 'text-ink-3/40'
          }`}
        >
          {Math.round(level * 100)}%
        </span>
        <button
          type="button"
          onClick={() => onToggle(id)}
          disabled={!isArmed}
          aria-pressed={isOn}
          title={isOn ? `ปิดช่อง${info.label}` : `เปิดช่อง${info.label}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all duration-200 active:scale-90 disabled:pointer-events-none disabled:opacity-40"
          style={
            isOn
              ? {
                  borderColor: accent,
                  color: accent,
                  backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`,
                }
              : undefined
          }
        >
          <Power aria-hidden className="h-3 w-3" />
        </button>
      </div>

      {/* ---- Row 2: where this rack lands -------------------------------------
          A rack acting on nothing is the reason these knobs have felt dead, so
          this says which strip it is on — and offers to put the input there when
          the answer is "none".

          Two separate facts, and merging them was a lie:
            - Is this rack being fed *right now*? True while this page owns the
              monitor, whatever the desk holds.
            - Does the desk strip carrying it have a source of its own?
          The first version reported only the second and printed "ไม่มีสัญญาณ"
          beside meters reading −1.6 dBFS. The fix overshot and reported only the
          first, so all six rows claimed a live desk channel while the desk showed
          seven NO SOURCE. Both get said, and the strip that is still empty keeps
          its one-click offer.

          One line, clipped rather than wrapped. The wrapping version pushed the
          fader down by a line on whichever channels happened to have the longest
          carrier name, so the six faders no longer lined up. */}
      <p className="flex h-3 items-center gap-1 overflow-hidden font-mono text-[8px] leading-none tracking-[0.08em] whitespace-nowrap uppercase text-ink-3">
        {playing.length > 0 ? (
          <span className="truncate text-cyan" title={carrier?.name}>
            ● {carrier?.name}
          </span>
        ) : hasLiveFeed ? (
          <>
            <span className="shrink-0 text-cyan">● สัญญาณสด</span>
            {carrier ? (
              <>
                <span aria-hidden className="shrink-0 text-ink-3/50">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => onPutLive?.(id)}
                  disabled={!isArmed || !onPutLive}
                  title={`${carrier.name} ยังไม่มีสัญญาณบนมิกเซอร์ — กดเพื่อใส่ให้`}
                  className="truncate text-amber underline decoration-dotted underline-offset-2 disabled:no-underline disabled:opacity-60"
                >
                  {carrier.name} ว่าง
                </button>
              </>
            ) : null}
          </>
        ) : carrier ? (
          <button
            type="button"
            onClick={() => onPutLive?.(id)}
            disabled={!isArmed || !onPutLive}
            title={`${carrier.name} carries this rack but is playing nothing — put the live input on it`}
            className="truncate text-rec underline decoration-dotted underline-offset-2 disabled:no-underline disabled:opacity-60"
          >
            ○ {carrier.name} · ไม่มีสัญญาณ
          </button>
        ) : (
          // An empty slot rather than nothing: without it this strip is a line
          // shorter than its neighbours and its fader sits higher than theirs.
          <span aria-hidden className="text-ink-3/30">
            —
          </span>
        )}
      </p>

      {/* ---- Row 3: the fader -------------------------------------------------
          Horizontal after all. Upright freed width and spent travel, and in a
          strip this size travel is what a fader is for. The vertical variant stays
          in `MiniSlider` and `globals.css` for the wider console strips, where a
          column can be tall enough to earn it. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!isOn}
          title={`ลดระดับเสียง${info.label}ทีละ 1%`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-line bg-raised font-mono text-[10px] leading-none font-bold text-ink-3 transition-all duration-100 hover:border-ink-3/50 hover:text-ink active:scale-90 disabled:pointer-events-none disabled:opacity-30 select-none"
          {...decrementHandlers}
        >
          -
        </button>
        <div className="min-w-0 flex-1">
          <MiniSlider
            label=""
            value={level}
            min={0}
            max={1.5}
            step={0.01}
            disabled={!isOn}
            onChange={(value) => onLevel(id, value)}
            inputClassName="h-5!"
          />
        </div>
        <button
          type="button"
          disabled={!isOn}
          title={`เพิ่มระดับเสียง${info.label}ทีละ 1%`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-line bg-raised font-mono text-[10px] leading-none font-bold text-ink-3 transition-all duration-100 hover:border-ink-3/50 hover:text-ink active:scale-90 disabled:pointer-events-none disabled:opacity-30 select-none"
          {...incrementHandlers}
        >
          +
        </button>
      </div>
    </div>
  );
}
