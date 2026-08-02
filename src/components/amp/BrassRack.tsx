'use client';

import { Wind } from 'lucide-react';
import type { RefObject } from 'react';

import { Knob } from '@/components/ui/Knob';
import { Chip, Panel } from '@/components/ui/Panel';
import { useAccent } from '@/hooks/useAccent';
import { BRASS_PRESETS, type BrassSettings } from '@/lib/brassFx';
import { ToneAssistant } from '@/components/recorder/ToneAssistant';
import { BRASS_LEXICON } from '@/lib/rigLexicon';

import { Block, BypassSwitch, GainReduction, KnobRow, Legend, Row, signed } from './RackParts';

interface BrassRackProps {
  brass: BrassSettings;
  onChange: (brass: BrassSettings) => void;
  isEnabled: boolean;
  onToggle: () => void;
  limiterReductionRef: RefObject<number>;
  gateReductionRef: RefObject<number>;
  isArmed: boolean;
}

/**
 * BrassRack — control panel for woodwinds and brass instruments (Saxophone, Trumpet, Flute, etc.).
 */
export function BrassRack({
  brass,
  onChange,
  isEnabled,
  onToggle,
  limiterReductionRef,
  gateReductionRef,
  isArmed,
}: BrassRackProps) {
  const patch = (change: Partial<BrassSettings>) => onChange({ ...brass, ...change });
  const { accent } = useAccent();
  const colour = accent.colour;
  const isLive = isEnabled && isArmed;

  const selected = {
    borderColor: colour,
    color: colour,
    backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`,
  };

  const activePreset = BRASS_PRESETS.find(
    (preset) => JSON.stringify(preset.settings) === JSON.stringify(brass),
  );

  return (
    <Panel
      title="Brass & Woodwinds"
      icon={<Wind aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone={isEnabled ? 'strong' : 'muted'} title="ใช้กับการมอนิเตอร์ ไม่ถูกบันทึกลงไฟล์">
            monitor only
          </Chip>
          <GainReduction
            label="GR"
            reductionRef={limiterReductionRef}
            active={isLive && brass.limiter.enabled}
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
          {/* ---- Column 1: Presets & Front end ---- */}
          <div className="flex flex-col gap-2.5">
            <section>
              <Legend>Preset</Legend>
              <div className="flex flex-wrap gap-1.5">
                {BRASS_PRESETS.map((preset) => (
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
                  value={brass.inputDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(brass.inputDb)}
                  hint="Trim before everything else in the brass chain."
                  onChange={(inputDb) => patch({ inputDb })}
                />
              </KnobRow>

              <Row
                label="Gate"
                enabled={brass.gate.enabled}
                accent={colour}
                onToggle={() => patch({ gate: { ...brass.gate, enabled: !brass.gate.enabled } })}
                hint="Gate input noise between solos/notes."
              >
                <GainReduction
                  label=""
                  reductionRef={gateReductionRef}
                  active={isLive && brass.gate.enabled}
                />
              </Row>
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={brass.gate.thresholdDb}
                  min={-80}
                  max={-20}
                  step={1}
                  accent={colour}
                  disabled={!brass.gate.enabled}
                  readout={`${brass.gate.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ gate: { ...brass.gate, thresholdDb } })}
                />
              </KnobRow>
            </Block>

            <ToneAssistant
              settings={brass}
              onChange={onChange}
              lexicon={BRASS_LEXICON}
              instrument="brass"
              accent={colour}
              isLive={isLive}
            />
          </div>

          {/* ---- Column 2: Compressor & EQ ---- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Dynamics">
              <Row
                label="Compressor"
                enabled={brass.comp.enabled}
                accent={colour}
                onToggle={() => patch({ comp: { ...brass.comp, enabled: !brass.comp.enabled } })}
                hint="Level horn peaks and stabilize dynamic fluctuations."
              />
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={brass.comp.thresholdDb}
                  min={-48}
                  max={0}
                  step={1}
                  accent={colour}
                  disabled={!brass.comp.enabled}
                  readout={`${brass.comp.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ comp: { ...brass.comp, thresholdDb } })}
                />
                <Knob
                  label="Ratio"
                  value={brass.comp.ratio}
                  min={1}
                  max={12}
                  step={0.5}
                  accent={colour}
                  disabled={!brass.comp.enabled}
                  readout={`${brass.comp.ratio}:1`}
                  onChange={(ratio) => patch({ comp: { ...brass.comp, ratio } })}
                />
                <Knob
                  label="Attack"
                  value={brass.comp.attack}
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  accent={colour}
                  disabled={!brass.comp.enabled}
                  readout={`${Math.round(brass.comp.attack * 1000)}ms`}
                  onChange={(attack) => patch({ comp: { ...brass.comp, attack } })}
                />
                <Knob
                  label="Release"
                  value={brass.comp.release}
                  min={0.01}
                  max={1.0}
                  step={0.01}
                  accent={colour}
                  disabled={!brass.comp.enabled}
                  readout={`${Math.round(brass.comp.release * 1000)}ms`}
                  onChange={(release) => patch({ comp: { ...brass.comp, release } })}
                />
              </KnobRow>
            </Block>

            <Block name="EQ">
              <KnobRow>
                <Knob
                  label="Warmth"
                  value={brass.eq.lowDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(brass.eq.lowDb)}
                  hint="Low-mid shelf warmth around 350 Hz."
                  onChange={(lowDb) => patch({ eq: { ...brass.eq, lowDb } })}
                />
                <Knob
                  label="Bite"
                  value={brass.eq.midDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(brass.eq.midDb)}
                  hint="Peaking EQ (Horns cut-through) around 3.2 kHz."
                  onChange={(midDb) => patch({ eq: { ...brass.eq, midDb } })}
                />
                <Knob
                  label="Air"
                  value={brass.eq.highDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(brass.eq.highDb)}
                  hint="High shelf (Wind hiss/air) around 8.5 kHz."
                  onChange={(highDb) => patch({ eq: { ...brass.eq, highDb } })}
                />
              </KnobRow>
            </Block>
          </div>

          {/* ---- Column 3: Delay, Reverb & Output ---- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Delay">
              <Row
                label="Slap Echo"
                enabled={brass.delay.enabled}
                accent={colour}
                onToggle={() => patch({ delay: { ...brass.delay, enabled: !brass.delay.enabled } })}
                hint="Damped delay lines for horn depth."
              />
              <KnobRow>
                <Knob
                  label="Time"
                  value={brass.delay.timeMs}
                  min={50}
                  max={1500}
                  step={10}
                  accent={colour}
                  disabled={!brass.delay.enabled}
                  readout={`${brass.delay.timeMs}ms`}
                  onChange={(timeMs) => patch({ delay: { ...brass.delay, timeMs } })}
                />
                <Knob
                  label="Feedback"
                  value={brass.delay.feedback}
                  min={0}
                  max={0.95}
                  step={0.01}
                  accent={colour}
                  disabled={!brass.delay.enabled}
                  readout={`${Math.round(brass.delay.feedback * 100)}%`}
                  onChange={(feedback) => patch({ delay: { ...brass.delay, feedback } })}
                />
                <Knob
                  label="Mix"
                  value={brass.delay.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!brass.delay.enabled}
                  readout={`${Math.round(brass.delay.mix * 100)}%`}
                  onChange={(mix) => patch({ delay: { ...brass.delay, mix } })}
                />
              </KnobRow>
            </Block>

            <Block name="Reverb">
              <Row
                label="Space"
                enabled={brass.reverb.enabled}
                accent={colour}
                onToggle={() => patch({ reverb: { ...brass.reverb, enabled: !brass.reverb.enabled } })}
                hint="Convolver space reverb."
              />
              <KnobRow>
                <Knob
                  label="Size"
                  value={brass.reverb.sizeSec}
                  min={0.3}
                  max={5.0}
                  step={0.1}
                  accent={colour}
                  disabled={!brass.reverb.enabled}
                  readout={`${brass.reverb.sizeSec.toFixed(1)}s`}
                  onChange={(sizeSec) => patch({ reverb: { ...brass.reverb, sizeSec } })}
                />
                <Knob
                  label="Mix"
                  value={brass.reverb.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!brass.reverb.enabled}
                  readout={`${Math.round(brass.reverb.mix * 100)}%`}
                  onChange={(mix) => patch({ reverb: { ...brass.reverb, mix } })}
                />
              </KnobRow>
            </Block>

            <Block name="Output">
              <KnobRow>
                <Knob
                  label="Output"
                  value={brass.outputDb}
                  min={-24}
                  max={24}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(brass.outputDb)}
                  hint="Final gain trim for brass amped level into monitor bus."
                  onChange={(outputDb) => patch({ outputDb })}
                />
              </KnobRow>

              <Row
                label="Limiter"
                enabled={brass.limiter.enabled}
                accent={colour}
                onToggle={() => patch({ limiter: { ...brass.limiter, enabled: !brass.limiter.enabled } })}
                hint="Brickwall safety limiter."
              />
              <KnobRow>
                <Knob
                  label="Ceiling"
                  value={brass.limiter.ceilingDb}
                  min={-12}
                  max={0}
                  step={0.1}
                  accent={colour}
                  disabled={!brass.limiter.enabled}
                  readout={`${brass.limiter.ceilingDb.toFixed(1)}dB`}
                  onChange={(ceilingDb) => patch({ limiter: { ...brass.limiter, ceilingDb } })}
                />
              </KnobRow>
            </Block>
          </div>
        </div>
      </div>
    </Panel>
  );
}
