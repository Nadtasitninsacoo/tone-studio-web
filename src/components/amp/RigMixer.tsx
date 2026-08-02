'use client';

import { Drum, Guitar, Power, Waves, Mic, Keyboard, Wind, type LucideIcon } from 'lucide-react';

import { MiniSlider } from '@/components/ui/Controls';
import { INSTRUMENT_INFO, INSTRUMENTS, type Instrument } from '@/lib/rig';
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
      <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
        <p className="font-mono text-[9px] font-semibold tracking-[0.16em] uppercase text-ink-3">
          Rig mixer
        </p>
        <p className="font-mono text-[9px] tracking-wider uppercase text-ink-3">
          {liveCount === 0
            ? 'ทุกช่องปิด — ได้ยินสัญญาณดิบ'
            : `${liveCount} ช่องเปิดพร้อมกัน`}
        </p>
      </div>

      <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-6">
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
      className="flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors duration-200"
      style={
        isShown
          ? {
              borderColor: accent,
              backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
            }
          : { borderColor: 'transparent' }
      }
    >
      {/* The channel switch. Separate from the row below it on purpose: this
          is what you hear, that is what you see. */}
      <button
        type="button"
        onClick={() => onToggle(id)}
        disabled={!isArmed}
        aria-pressed={isOn}
        title={isOn ? `ปิดช่อง${info.label}` : `เปิดช่อง${info.label}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40"
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
        <Power aria-hidden className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onSelect(id)}
          title={`แสดงแร็ค${info.label} — ${info.hint}`}
          className="flex w-full items-center gap-1 text-left"
        >
          <Icon aria-hidden className="h-3 w-3 shrink-0 text-ink-3" />
          <span
            className={`truncate text-[11px] font-semibold leading-tight ${
              isOn ? 'text-ink' : 'text-ink-3'
            }`}
          >
            {info.label}
          </span>
        </button>

        {/* Where this rack lands. A rack acting on nothing is the reason these knobs
            have felt dead, so it says which strip it is on — and offers to put the
            input there when the answer is "none".

            The live feed is checked *first*, and it outranks the desk: while this page is
            the one carrying the input, the knobs act on the signal whether or not any
            mixer channel holds a source, so the desk's emptiness is not the answer to the
            question this line asks. */}
        {hasLiveFeed ? (
          <p className="truncate font-mono text-[8px] leading-tight tracking-[0.1em] uppercase text-ink-3">
            <span className="text-cyan">● สัญญาณสด{carrier ? ` · ${carrier.name}` : ''}</span>
          </p>
        ) : carrier ? (
          <p className="truncate font-mono text-[8px] leading-tight tracking-[0.1em] uppercase text-ink-3">
            {playing.length > 0 ? (
              <span className="text-cyan">● {carrier.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => onPutLive?.(id)}
                disabled={!isArmed || !onPutLive}
                title={`${carrier.name} carries this rack but is playing nothing — put the live input on it`}
                className="text-rec underline decoration-dotted disabled:no-underline disabled:opacity-60"
              >
                ○ {carrier.name} · ไม่มีสัญญาณ
              </button>
            )}
          </p>
        ) : null}

        {/* Kept mounted while the channel is off, just disabled: a fader that
            disappears takes its value's visibility with it, and the value is
            what you set before switching the channel back on. */}
        <div className="flex flex-col items-stretch mt-0.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!isOn}
              title={`ลดระดับเสียง${info.label}ทีละ 1%`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-raised font-mono text-[10px] font-bold text-ink-3 hover:text-ink active:scale-95 transition-all duration-100 disabled:pointer-events-none disabled:opacity-35 select-none"
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
              />
            </div>
            <button
              type="button"
              disabled={!isOn}
              title={`เพิ่มระดับเสียง${info.label}ทีละ 1%`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-raised font-mono text-[10px] font-bold text-ink-3 hover:text-ink active:scale-95 transition-all duration-100 disabled:pointer-events-none disabled:opacity-35 select-none"
              {...incrementHandlers}
            >
              +
            </button>
          </div>
          <span className={`text-center font-mono text-[9px] tabular-nums mt-0.5 select-none transition-colors duration-150 ${isOn ? 'text-ink-2' : 'text-ink-3/40'}`}>
            {Math.round(level * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
