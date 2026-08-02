'use client';

import { Speaker, Waves } from 'lucide-react';
import type { RefObject } from 'react';

import { Knob } from '@/components/ui/Knob';
import { Chip, Panel } from '@/components/ui/Panel';
import { useAccent } from '@/hooks/useAccent';
import { BASS_EQ_HZ, BASS_PRESETS, type BassSettings } from '@/lib/bassFx';
import { cabinetsFor } from '@/lib/cabinet';

import { ToneAssistant } from '@/components/recorder/ToneAssistant';
import { BASS_LEXICON } from '@/lib/rigLexicon';

import { Block, BypassSwitch, GainReduction, KnobRow, Legend, Row, signed } from './RackParts';

interface BassRackProps {
  bass: BassSettings;
  onChange: (bass: BassSettings) => void;
  isEnabled: boolean;
  onToggle: () => void;
  limiterReductionRef: RefObject<number>;
  gateReductionRef: RefObject<number>;
  isArmed: boolean;
}

/**
 * BassRack — the bass rig's controls.
 *
 * ---------------------------------------------------------------------------
 * The two controls that make this a bass rig, and where they are.
 *
 * **Crossover** is in the second column, above the drive, because that is the order
 * it happens in and because it is the reason the drive is safe to use at all: only
 * the band above it is distorted. A player who turns the drive up and hears the note
 * stay solid is hearing this control, and it should be the one they find first.
 *
 * **DI** is in the last column beside the output, because that is what it is — a
 * balance, not a tone. It blends the untouched signal from before the drive and the
 * cabinet against everything after them.
 *
 * Layout follows the guitar rack: three columns, two blocks each, ending level.
 * `lib/bassFx.ts` has the reasoning for every value here.
 * ---------------------------------------------------------------------------
 */
export function BassRack({
  bass,
  onChange,
  isEnabled,
  onToggle,
  limiterReductionRef,
  gateReductionRef,
  isArmed,
}: BassRackProps) {
  const patch = (change: Partial<BassSettings>) => onChange({ ...bass, ...change });
  const { accent } = useAccent();
  const colour = accent.colour;
  const isLive = isEnabled && isArmed;

  const selected = {
    borderColor: colour,
    color: colour,
    backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`,
  };

  const activePreset = BASS_PRESETS.find(
    (preset) => JSON.stringify(preset.settings) === JSON.stringify(bass),
  );

  return (
    <Panel
      title="Bass Rig"
      icon={<Waves aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone={isEnabled ? 'strong' : 'muted'} title="ใช้กับการมอนิเตอร์ ไม่ถูกบันทึกลงไฟล์">
            monitor only
          </Chip>
          <GainReduction
            label="GR"
            reductionRef={limiterReductionRef}
            active={isLive && bass.limiter.enabled}
          />
          <BypassSwitch
            isEnabled={isEnabled}
            onToggle={onToggle}
            disabled={!isArmed}
            accent={colour}
          />
        </>
      }
    >
      <div className={`@container flex flex-col gap-2.5 ${isLive ? '' : 'opacity-45'}`}>
        <div className="grid items-start gap-2.5 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {/* ---- Column 1: presets, then the front end -------------------- */}
          <div className="flex flex-col gap-2.5">
            <section>
              <Legend>Preset</Legend>
              <div className="flex flex-wrap gap-1.5">
                {BASS_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange(preset.settings)}
                    title={preset.hint}
                    className="rounded-md border border-line bg-panel px-2 py-1 text-left transition-colors duration-200 hover:text-ink"
                    style={activePreset?.id === preset.id ? selected : undefined}
                  >
                    <span className="block text-[11px] font-semibold leading-tight">
                      {preset.label}
                    </span>
                    <span className="block font-mono text-[8px] uppercase tracking-wider text-ink-3">
                      {preset.latin}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-ink-3">
                {activePreset?.hint ?? 'ปรับเองแล้ว — ไม่ตรงกับพรีเซ็ตไหน'}
              </p>
            </section>

            <Block name="Front end">
              <KnobRow>
                <Knob
                  label="Input"
                  value={bass.inputDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(bass.inputDb)}
                  hint="Trim before the gate and the compressor."
                  onChange={(inputDb) => patch({ inputDb })}
                />
              </KnobRow>

              <Row
                label="Gate"
                enabled={bass.gate.enabled}
                accent={colour}
                onToggle={() => patch({ gate: { ...bass.gate, enabled: !bass.gate.enabled } })}
                hint="Lower than the guitar's by default: a bass string rings for a long time, and a gate that closes on the tail is worse than the hiss it removes."
              >
                <GainReduction
                  label=""
                  reductionRef={gateReductionRef}
                  active={isLive && bass.gate.enabled}
                />
              </Row>
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={bass.gate.thresholdDb}
                  min={-80}
                  max={-20}
                  step={1}
                  accent={colour}
                  disabled={!bass.gate.enabled}
                  readout={`${bass.gate.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ gate: { ...bass.gate, thresholdDb } })}
                />
              </KnobRow>

              <Row
                label="Compressor"
                enabled={bass.comp.enabled}
                accent={colour}
                onToggle={() => patch({ comp: { ...bass.comp, enabled: !bass.comp.enabled } })}
                hint="Attack 12 ms, release 280 ms — three times the guitar's. A bass note's attack is the note; catching it faster flattens it into a click."
              />
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={bass.comp.thresholdDb}
                  min={-48}
                  max={0}
                  step={1}
                  accent={colour}
                  disabled={!bass.comp.enabled}
                  readout={`${bass.comp.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ comp: { ...bass.comp, thresholdDb } })}
                />
                <Knob
                  label="Ratio"
                  value={bass.comp.ratio}
                  min={1}
                  max={12}
                  step={0.5}
                  accent={colour}
                  disabled={!bass.comp.enabled}
                  readout={`${bass.comp.ratio}:1`}
                  onChange={(ratio) => patch({ comp: { ...bass.comp, ratio } })}
                />
              </KnobRow>
              {/* Timing. These two are the difference between แน่น and กระหึ่ม, and no
                  threshold/ratio pair reaches either end: a 3 ms attack catches the pick
                  itself, a 40 ms one lets the whole fundamental through before any gain
                  reduction arrives. Ranges match `BASS_RANGES` exactly — a knob whose
                  travel disagreed with the clamp would move and then snap back. */}
              <KnobRow>
                <Knob
                  label="Attack"
                  value={bass.comp.attackMs}
                  min={1}
                  max={60}
                  step={1}
                  accent={colour}
                  disabled={!bass.comp.enabled}
                  readout={`${bass.comp.attackMs}ms`}
                  onChange={(attackMs) => patch({ comp: { ...bass.comp, attackMs } })}
                />
                <Knob
                  label="Release"
                  value={bass.comp.releaseMs}
                  min={40}
                  max={800}
                  step={10}
                  accent={colour}
                  disabled={!bass.comp.enabled}
                  readout={`${bass.comp.releaseMs}ms`}
                  onChange={(releaseMs) => patch({ comp: { ...bass.comp, releaseMs } })}
                />
              </KnobRow>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
                เร็ว + คลายสั้น = แน่น เก็บหัวโน้ต · ช้า + คลายยาว = กระหึ่ม หางยาว
              </p>
            </Block>

            {/* Same assistant as the guitar rack, reading this instrument's lexicon:
                "หนาขึ้น" moves the controls that mean thickness *here*. See
                `lib/rigLexicon.ts`. */}
            <ToneAssistant
              settings={bass}
              onChange={onChange}
              lexicon={BASS_LEXICON}
              instrument="bass"
              accent={colour}
              isLive={isLive}
            />
          </div>

          {/* ---- Column 2: the split, the drive above it, then the EQ ------ */}
          <div className="flex flex-col gap-2.5">
            <Block name="Crossover">
              <KnobRow>
                <Knob
                  label="Split"
                  value={bass.crossoverHz}
                  min={80}
                  max={400}
                  step={5}
                  accent={colour}
                  readout={`${bass.crossoverHz}Hz`}
                  hint="Everything below this stays clean. Raise it and more of the note survives the drive."
                  onChange={(crossoverHz) => patch({ crossoverHz })}
                />
                <Knob
                  label="Low"
                  value={bass.lowDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(bass.lowDb)}
                  hint="Level of the clean low band — the weight control."
                  onChange={(lowDb) => patch({ lowDb })}
                />
              </KnobRow>
              <p className="text-[9px] leading-snug text-ink-3">
                Linkwitz-Riley, 4th order. Only the band <strong className="font-semibold text-ink-2">above</strong>{' '}
                the split reaches the drive — distorting a 41&nbsp;Hz fundamental replaces it
                with harmonics rather than adding to it.
              </p>

              <Row
                label="Drive"
                enabled={bass.drive.enabled}
                accent={colour}
                onToggle={() => patch({ drive: { ...bass.drive, enabled: !bass.drive.enabled } })}
                hint="High band only. The low band never sees it."
              />
              <KnobRow>
                <Knob
                  label="Amount"
                  value={bass.drive.amount}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!bass.drive.enabled}
                  readout={`${Math.round(bass.drive.amount * 100)}%`}
                  onChange={(amount) => patch({ drive: { ...bass.drive, amount } })}
                />
                <Knob
                  label="Bias"
                  value={bass.drive.bias}
                  min={0}
                  max={0.4}
                  step={0.01}
                  accent={colour}
                  disabled={!bass.drive.enabled}
                  readout={bass.drive.bias === 0 ? 'sym' : bass.drive.bias.toFixed(2)}
                  hint="Valve asymmetry. At 0 it is a symmetric fuzz."
                  onChange={(bias) => patch({ drive: { ...bass.drive, bias } })}
                />
              </KnobRow>
            </Block>

            <Block name="Graphic EQ">
              <KnobRow>
                <Knob
                  label="Sub"
                  value={bass.eq.subDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(bass.eq.subDb)}
                  hint={`${BASS_EQ_HZ.sub} Hz — the fundamental. Whether the note is felt.`}
                  onChange={(subDb) => patch({ eq: { ...bass.eq, subDb } })}
                />
                <Knob
                  label="Low mid"
                  value={bass.eq.lowMidDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(bass.eq.lowMidDb)}
                  hint={`${BASS_EQ_HZ.lowMid} Hz — where a room turns a bass into cardboard. Usually a cut.`}
                  onChange={(lowMidDb) => patch({ eq: { ...bass.eq, lowMidDb } })}
                />
                <Knob
                  label="Mid"
                  value={bass.eq.midDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(bass.eq.midDb)}
                  hint={`${BASS_EQ_HZ.mid} Hz — the note you hear on a phone speaker.`}
                  onChange={(midDb) => patch({ eq: { ...bass.eq, midDb } })}
                />
                <Knob
                  label="High"
                  value={bass.eq.highDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(bass.eq.highDb)}
                  hint={`${BASS_EQ_HZ.high} Hz — pick, fret and string noise.`}
                  onChange={(highDb) => patch({ eq: { ...bass.eq, highDb } })}
                />
              </KnobRow>
              <p className="text-[9px] leading-snug text-ink-3">
                Four bands after the drive, not a tone stack before it. On a bass the EQ is
                for fitting the note into a mix, which is a job that happens once the
                harmonics already exist.
              </p>
            </Block>
          </div>

          {/* ---- Column 3: the speaker, then the blend and the output ------ */}
          <div className="flex flex-col gap-2.5">
            <Block name="Cabinet">
              <Row
                label="Cabinet"
                enabled={bass.cab.enabled}
                accent={colour}
                onToggle={() => patch({ cab: { ...bass.cab, enabled: !bass.cab.enabled } })}
                hint="Mono, unlike the guitar's dual-mono pair: a bass has to survive a mono fold-down, and width is exactly what that destroys."
              >
                <Speaker aria-hidden className="h-3 w-3 text-ink-3" />
              </Row>
              <div className="grid grid-cols-2 gap-1">
                {cabinetsFor('bass').map((cabinet) => (
                  <button
                    key={cabinet.id}
                    type="button"
                    disabled={!bass.cab.enabled}
                    onClick={() => patch({ cab: { ...bass.cab, model: cabinet.id } })}
                    title={cabinet.hint}
                    className="rounded border border-line px-1.5 py-1 text-[10px] font-medium text-ink-2 transition-colors duration-200 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                    style={bass.cab.model === cabinet.id ? selected : undefined}
                  >
                    {cabinet.label}
                  </button>
                ))}
              </div>
              <KnobRow>
                <Knob
                  label="Presence"
                  value={bass.cab.presenceDb}
                  min={-6}
                  max={6}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  disabled={!bass.cab.enabled}
                  readout={signed(bass.cab.presenceDb)}
                  onChange={(presenceDb) => patch({ cab: { ...bass.cab, presenceDb } })}
                />
                <Knob
                  label="Reso"
                  value={bass.cab.resonanceDb}
                  // ±9 to match `BASS_RANGES.resonanceDb`: an offset on the cabinet's own
                  // resonance (3–5 dB by model), so this is what takes a 1×15 from damped
                  // flat to genuinely booming. The clamp and the travel have to agree.
                  min={-9}
                  max={9}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  disabled={!bass.cab.enabled}
                  readout={signed(bass.cab.resonanceDb)}
                  onChange={(resonanceDb) => patch({ cab: { ...bass.cab, resonanceDb } })}
                />
              </KnobRow>
            </Block>

            <Block name="Blend & output">
              <KnobRow>
                <Knob
                  label="DI"
                  value={bass.diMix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  readout={`${Math.round(bass.diMix * 100)}%`}
                  hint="The untouched signal from before the drive and the cabinet, blended against everything after them. Equal-power, so the middle does not dip."
                  onChange={(diMix) => patch({ diMix })}
                />
                <Knob
                  label="Output"
                  value={bass.outputDb}
                  min={-24}
                  max={24}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(bass.outputDb)}
                  onChange={(outputDb) => patch({ outputDb })}
                />
              </KnobRow>

              <Row
                label="Limiter"
                enabled={bass.limiter.enabled}
                accent={colour}
                onToggle={() =>
                  patch({ limiter: { ...bass.limiter, enabled: !bass.limiter.enabled } })
                }
                hint="Look-ahead brickwall, last in the chain. A bass is the easiest thing in a mix to clip."
              />
              <KnobRow>
                <Knob
                  label="Ceiling"
                  value={bass.limiter.ceilingDb}
                  min={-12}
                  max={0}
                  step={0.1}
                  accent={colour}
                  disabled={!bass.limiter.enabled}
                  readout={`${bass.limiter.ceilingDb.toFixed(1)}dB`}
                  onChange={(ceilingDb) => patch({ limiter: { ...bass.limiter, ceilingDb } })}
                />
              </KnobRow>
              <p className="text-[9px] leading-snug text-ink-3">
                DI at 0% is the amp alone; at 100% it is the DI alone. Most recorded bass sits
                between 20 and 40 — the amp gives it weight, the DI gives it the string.
              </p>
            </Block>
          </div>
        </div>
      </div>
    </Panel>
  );
}
