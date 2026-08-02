'use client';

import { Mic } from 'lucide-react';
import type { RefObject } from 'react';

import { Knob } from '@/components/ui/Knob';
import { Chip, Panel } from '@/components/ui/Panel';
import { useAccent } from '@/hooks/useAccent';
import { VOCAL_PRESETS, type VocalSettings } from '@/lib/vocalFx';
import { ToneAssistant } from '@/components/recorder/ToneAssistant';
import { VOCAL_LEXICON } from '@/lib/rigLexicon';

import { Block, BypassSwitch, GainReduction, KnobRow, Legend, Row, signed } from './RackParts';

interface VocalRackProps {
  vocals: VocalSettings;
  onChange: (vocals: VocalSettings) => void;
  isEnabled: boolean;
  onToggle: () => void;
  limiterReductionRef: RefObject<number>;
  gateReductionRef: RefObject<number>;
  isArmed: boolean;
}

/**
 * VocalRack — the vocal effects strip.
 *
 * Provides full control over vocal processing: Noise Gate, De-esser,
 * Compressor, EQ, Feedback Delay, and Reverb space.
 */
export function VocalRack({
  vocals,
  onChange,
  isEnabled,
  onToggle,
  limiterReductionRef,
  gateReductionRef,
  isArmed,
}: VocalRackProps) {
  const patch = (change: Partial<VocalSettings>) => onChange({ ...vocals, ...change });
  const { accent } = useAccent();
  const colour = accent.colour;
  const isLive = isEnabled && isArmed;

  const selected = {
    borderColor: colour,
    color: colour,
    backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`,
  };

  const activePreset = VOCAL_PRESETS.find(
    (preset) => JSON.stringify(preset.settings) === JSON.stringify(vocals),
  );

  return (
    <Panel
      title="Vocal Strip"
      icon={<Mic aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone={isEnabled ? 'strong' : 'muted'} title="ใช้กับการมอนิเตอร์ ไม่ถูกบันทึกลงไฟล์">
            monitor only
          </Chip>
          <GainReduction
            label="GR"
            reductionRef={limiterReductionRef}
            active={isLive && vocals.limiter.enabled}
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
                {VOCAL_PRESETS.map((preset) => (
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
                  value={vocals.inputDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(vocals.inputDb)}
                  hint="Trim before everything else in the vocal chain."
                  onChange={(inputDb) => patch({ inputDb })}
                />
              </KnobRow>

              <Row
                label="Gate"
                enabled={vocals.gate.enabled}
                accent={colour}
                onToggle={() => patch({ gate: { ...vocals.gate, enabled: !vocals.gate.enabled } })}
                hint="Clean up silences between vocal phrases."
              >
                <GainReduction
                  label=""
                  reductionRef={gateReductionRef}
                  active={isLive && vocals.gate.enabled}
                />
              </Row>
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={vocals.gate.thresholdDb}
                  min={-80}
                  max={-20}
                  step={1}
                  accent={colour}
                  disabled={!vocals.gate.enabled}
                  readout={`${vocals.gate.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ gate: { ...vocals.gate, thresholdDb } })}
                />
              </KnobRow>
            </Block>

            <ToneAssistant
              settings={vocals}
              onChange={onChange}
              lexicon={VOCAL_LEXICON}
              instrument="vocals"
              accent={colour}
              isLive={isLive}
            />
          </div>

          {/* ---- Column 2: Dynamics & EQ ---- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Dynamics">
              <Row
                label="De-esser"
                enabled={vocals.deEsser.enabled}
                accent={colour}
                onToggle={() => patch({ deEsser: { ...vocals.deEsser, enabled: !vocals.deEsser.enabled } })}
                hint="Tame harsh sibilance ('s' and 't' sounds) using split-band high-frequency compression."
              />
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={vocals.deEsser.thresholdDb}
                  min={-60}
                  max={0}
                  step={1}
                  accent={colour}
                  disabled={!vocals.deEsser.enabled}
                  readout={`${vocals.deEsser.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ deEsser: { ...vocals.deEsser, thresholdDb } })}
                />
                <Knob
                  label="Ratio"
                  value={vocals.deEsser.ratio}
                  min={1}
                  max={10}
                  step={0.5}
                  accent={colour}
                  disabled={!vocals.deEsser.enabled}
                  readout={`${vocals.deEsser.ratio}:1`}
                  onChange={(ratio) => patch({ deEsser: { ...vocals.deEsser, ratio } })}
                />
              </KnobRow>

              <Row
                label="Compressor"
                enabled={vocals.comp.enabled}
                accent={colour}
                onToggle={() => patch({ comp: { ...vocals.comp, enabled: !vocals.comp.enabled } })}
                hint="Vocal compressor to control dynamic ranges and smooth out performance."
              />
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={vocals.comp.thresholdDb}
                  min={-60}
                  max={0}
                  step={1}
                  accent={colour}
                  disabled={!vocals.comp.enabled}
                  readout={`${vocals.comp.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ comp: { ...vocals.comp, thresholdDb } })}
                />
                <Knob
                  label="Ratio"
                  value={vocals.comp.ratio}
                  min={1}
                  max={10}
                  step={0.5}
                  accent={colour}
                  disabled={!vocals.comp.enabled}
                  readout={`${vocals.comp.ratio}:1`}
                  onChange={(ratio) => patch({ comp: { ...vocals.comp, ratio } })}
                />
                <Knob
                  label="Attack"
                  value={vocals.comp.attack}
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  accent={colour}
                  disabled={!vocals.comp.enabled}
                  readout={`${Math.round(vocals.comp.attack * 1000)}ms`}
                  onChange={(attack) => patch({ comp: { ...vocals.comp, attack } })}
                />
                <Knob
                  label="Release"
                  value={vocals.comp.release}
                  min={0.01}
                  max={1.0}
                  step={0.01}
                  accent={colour}
                  disabled={!vocals.comp.enabled}
                  readout={`${Math.round(vocals.comp.release * 1000)}ms`}
                  onChange={(release) => patch({ comp: { ...vocals.comp, release } })}
                />
              </KnobRow>
            </Block>

            <Block name="EQ">
              <Row
                label="Low Cut (100Hz)"
                enabled={vocals.eq.lowCutEnabled}
                accent={colour}
                onToggle={() => patch({ eq: { ...vocals.eq, lowCutEnabled: !vocals.eq.lowCutEnabled } })}
                hint="Cut sub-bass rumble and mud below 100Hz."
              />
              <KnobRow>
                <Knob
                  label="Body"
                  value={vocals.eq.bodyDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(vocals.eq.bodyDb)}
                  hint="Body/Warmth boost/cut around 200 Hz."
                  onChange={(bodyDb) => patch({ eq: { ...vocals.eq, bodyDb } })}
                />
                <Knob
                  label="Presence"
                  value={vocals.eq.presenceDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(vocals.eq.presenceDb)}
                  hint="Vocal presence boost/cut around 2.5 kHz."
                  onChange={(presenceDb) => patch({ eq: { ...vocals.eq, presenceDb } })}
                />
                <Knob
                  label="Air"
                  value={vocals.eq.airDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(vocals.eq.airDb)}
                  hint="Airy high-shelf boost/cut around 12 kHz."
                  onChange={(airDb) => patch({ eq: { ...vocals.eq, airDb } })}
                />
              </KnobRow>
            </Block>
          </div>

          {/* ---- Column 3: Effects & Output ---- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Delay">
              <Row
                label="Tape Echo"
                enabled={vocals.delay.enabled}
                accent={colour}
                onToggle={() => patch({ delay: { ...vocals.delay, enabled: !vocals.delay.enabled } })}
                hint="Damped tape delay feedback for vocal depth."
              />
              <KnobRow>
                <Knob
                  label="Time"
                  value={vocals.delay.timeMs}
                  min={50}
                  max={2000}
                  step={10}
                  accent={colour}
                  disabled={!vocals.delay.enabled}
                  readout={`${vocals.delay.timeMs}ms`}
                  onChange={(timeMs) => patch({ delay: { ...vocals.delay, timeMs } })}
                />
                <Knob
                  label="Feedback"
                  value={vocals.delay.feedback}
                  min={0}
                  max={0.95}
                  step={0.01}
                  accent={colour}
                  disabled={!vocals.delay.enabled}
                  readout={`${Math.round(vocals.delay.feedback * 100)}%`}
                  onChange={(feedback) => patch({ delay: { ...vocals.delay, feedback } })}
                />
                <Knob
                  label="Mix"
                  value={vocals.delay.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!vocals.delay.enabled}
                  readout={`${Math.round(vocals.delay.mix * 100)}%`}
                  onChange={(mix) => patch({ delay: { ...vocals.delay, mix } })}
                />
              </KnobRow>
            </Block>

            <Block name="Reverb">
              <Row
                label="Space"
                enabled={vocals.reverb.enabled}
                accent={colour}
                onToggle={() => patch({ reverb: { ...vocals.reverb, enabled: !vocals.reverb.enabled } })}
                hint="Convolver space effect for vocal acoustics."
              />
              <KnobRow>
                <Knob
                  label="Size"
                  value={vocals.reverb.sizeSec}
                  min={0.3}
                  max={5.0}
                  step={0.1}
                  accent={colour}
                  disabled={!vocals.reverb.enabled}
                  readout={`${vocals.reverb.sizeSec.toFixed(1)}s`}
                  onChange={(sizeSec) => patch({ reverb: { ...vocals.reverb, sizeSec } })}
                />
                <Knob
                  label="Mix"
                  value={vocals.reverb.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!vocals.reverb.enabled}
                  readout={`${Math.round(vocals.reverb.mix * 100)}%`}
                  onChange={(mix) => patch({ reverb: { ...vocals.reverb, mix } })}
                />
              </KnobRow>
            </Block>

            <Block name="Output">
              <KnobRow>
                <Knob
                  label="Output"
                  value={vocals.outputDb}
                  min={-24}
                  max={24}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(vocals.outputDb)}
                  hint="Final gain trim for balancing amped levels into monitor bus."
                  onChange={(outputDb) => patch({ outputDb })}
                />
              </KnobRow>

              <Row
                label="Limiter"
                enabled={vocals.limiter.enabled}
                accent={colour}
                onToggle={() => patch({ limiter: { ...vocals.limiter, enabled: !vocals.limiter.enabled } })}
                hint="Brickwall safety limiter to prevent digital clipping."
              />
              <KnobRow>
                <Knob
                  label="Ceiling"
                  value={vocals.limiter.ceilingDb}
                  min={-12}
                  max={0}
                  step={0.1}
                  accent={colour}
                  disabled={!vocals.limiter.enabled}
                  readout={`${vocals.limiter.ceilingDb.toFixed(1)}dB`}
                  onChange={(ceilingDb) => patch({ limiter: { ...vocals.limiter, ceilingDb } })}
                />
              </KnobRow>
            </Block>
          </div>
        </div>
      </div>
    </Panel>
  );
}
