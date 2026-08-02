'use client';

import { Keyboard } from 'lucide-react';
import type { RefObject } from 'react';

import { Knob } from '@/components/ui/Knob';
import { Chip, Panel } from '@/components/ui/Panel';
import { useAccent } from '@/hooks/useAccent';
import { KEYS_PRESETS, type KeysSettings } from '@/lib/keysFx';
import { ToneAssistant } from '@/components/recorder/ToneAssistant';
import { KEYS_LEXICON } from '@/lib/rigLexicon';

import { Block, BypassSwitch, GainReduction, KnobRow, Legend, Row, signed } from './RackParts';

interface KeysRackProps {
  keys: KeysSettings;
  onChange: (keys: KeysSettings) => void;
  isEnabled: boolean;
  onToggle: () => void;
  limiterReductionRef: RefObject<number>;
  gateReductionRef: RefObject<number>;
  isArmed: boolean;
}

/**
 * KeysRack — the Keyboard/Piano/Synth channel controls.
 */
export function KeysRack({
  keys,
  onChange,
  isEnabled,
  onToggle,
  limiterReductionRef,
  gateReductionRef,
  isArmed,
}: KeysRackProps) {
  const patch = (change: Partial<KeysSettings>) => onChange({ ...keys, ...change });
  const { accent } = useAccent();
  const colour = accent.colour;
  const isLive = isEnabled && isArmed;

  const selected = {
    borderColor: colour,
    color: colour,
    backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`,
  };

  const activePreset = KEYS_PRESETS.find(
    (preset) => JSON.stringify(preset.settings) === JSON.stringify(keys),
  );

  return (
    <Panel
      title="Keyboard & Synth"
      icon={<Keyboard aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone={isEnabled ? 'strong' : 'muted'} title="ใช้กับการมอนิเตอร์ ไม่ถูกบันทึกลงไฟล์">
            monitor only
          </Chip>
          <GainReduction
            label="GR"
            reductionRef={limiterReductionRef}
            active={isLive && keys.limiter.enabled}
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
                {KEYS_PRESETS.map((preset) => (
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
                  value={keys.inputDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(keys.inputDb)}
                  hint="Trim before everything else in the keyboard chain."
                  onChange={(inputDb) => patch({ inputDb })}
                />
              </KnobRow>

              <Row
                label="Gate"
                enabled={keys.gate.enabled}
                accent={colour}
                onToggle={() => patch({ gate: { ...keys.gate, enabled: !keys.gate.enabled } })}
                hint="Gate input noise during silences."
              >
                <GainReduction
                  label=""
                  reductionRef={gateReductionRef}
                  active={isLive && keys.gate.enabled}
                />
              </Row>
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={keys.gate.thresholdDb}
                  min={-80}
                  max={-20}
                  step={1}
                  accent={colour}
                  disabled={!keys.gate.enabled}
                  readout={`${keys.gate.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ gate: { ...keys.gate, thresholdDb } })}
                />
              </KnobRow>
            </Block>

            <ToneAssistant
              settings={keys}
              onChange={onChange}
              lexicon={KEYS_LEXICON}
              instrument="keys"
              accent={colour}
              isLive={isLive}
            />
          </div>

          {/* ---- Column 2: Chorus & EQ ---- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Modulation">
              <Row
                label="Stereo Chorus"
                enabled={keys.chorus.enabled}
                accent={colour}
                onToggle={() => patch({ chorus: { ...keys.chorus, enabled: !keys.chorus.enabled } })}
                hint="Add space, thickness, and wide stereo modulation."
              />
              <KnobRow>
                <Knob
                  label="Rate"
                  value={keys.chorus.rateHz}
                  min={0.1}
                  max={5.0}
                  step={0.05}
                  accent={colour}
                  disabled={!keys.chorus.enabled}
                  readout={`${keys.chorus.rateHz.toFixed(2)}Hz`}
                  onChange={(rateHz) => patch({ chorus: { ...keys.chorus, rateHz } })}
                />
                <Knob
                  label="Depth"
                  value={keys.chorus.depthMs}
                  min={0.1}
                  max={8.0}
                  step={0.1}
                  accent={colour}
                  disabled={!keys.chorus.enabled}
                  readout={`${keys.chorus.depthMs.toFixed(1)}ms`}
                  onChange={(depthMs) => patch({ chorus: { ...keys.chorus, depthMs } })}
                />
                <Knob
                  label="Mix"
                  value={keys.chorus.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!keys.chorus.enabled}
                  readout={`${Math.round(keys.chorus.mix * 100)}%`}
                  onChange={(mix) => patch({ chorus: { ...keys.chorus, mix } })}
                />
              </KnobRow>
            </Block>

            <Block name="EQ">
              <KnobRow>
                <Knob
                  label="Low"
                  value={keys.eq.lowDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(keys.eq.lowDb)}
                  hint="Low shelf (Warmth/Body) around 180 Hz."
                  onChange={(lowDb) => patch({ eq: { ...keys.eq, lowDb } })}
                />
                <Knob
                  label="Mid"
                  value={keys.eq.midDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(keys.eq.midDb)}
                  hint="Peaking EQ (Warmth/Clarity) around 1.2 kHz."
                  onChange={(midDb) => patch({ eq: { ...keys.eq, midDb } })}
                />
                <Knob
                  label="High"
                  value={keys.eq.highDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(keys.eq.highDb)}
                  hint="High shelf (Air/Sparkle) around 10 kHz."
                  onChange={(highDb) => patch({ eq: { ...keys.eq, highDb } })}
                />
              </KnobRow>
            </Block>

            <Block name="Compressor">
              <Row
                label="Comp"
                enabled={keys.comp.enabled}
                accent={colour}
                onToggle={() => patch({ comp: { ...keys.comp, enabled: !keys.comp.enabled } })}
                hint="Series compressor to balance playing dynamics."
              />
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={keys.comp.thresholdDb}
                  min={-48}
                  max={0}
                  step={1}
                  accent={colour}
                  disabled={!keys.comp.enabled}
                  readout={`${keys.comp.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ comp: { ...keys.comp, thresholdDb } })}
                />
                <Knob
                  label="Ratio"
                  value={keys.comp.ratio}
                  min={1}
                  max={12}
                  step={0.5}
                  accent={colour}
                  disabled={!keys.comp.enabled}
                  readout={`${keys.comp.ratio}:1`}
                  onChange={(ratio) => patch({ comp: { ...keys.comp, ratio } })}
                />
              </KnobRow>
            </Block>
          </div>

          {/* ---- Column 3: Reverb & Output ---- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Reverb">
              <Row
                label="Space"
                enabled={keys.reverb.enabled}
                accent={colour}
                onToggle={() => patch({ reverb: { ...keys.reverb, enabled: !keys.reverb.enabled } })}
                hint="Convolver space reverb."
              />
              <KnobRow>
                <Knob
                  label="Size"
                  value={keys.reverb.sizeSec}
                  min={0.3}
                  max={5.0}
                  step={0.1}
                  accent={colour}
                  disabled={!keys.reverb.enabled}
                  readout={`${keys.reverb.sizeSec.toFixed(1)}s`}
                  onChange={(sizeSec) => patch({ reverb: { ...keys.reverb, sizeSec } })}
                />
                <Knob
                  label="Mix"
                  value={keys.reverb.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!keys.reverb.enabled}
                  readout={`${Math.round(keys.reverb.mix * 100)}%`}
                  onChange={(mix) => patch({ reverb: { ...keys.reverb, mix } })}
                />
              </KnobRow>
            </Block>

            <Block name="Output">
              <KnobRow>
                <Knob
                  label="Output"
                  value={keys.outputDb}
                  min={-24}
                  max={24}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(keys.outputDb)}
                  hint="Final trim for keyboard level into monitor bus."
                  onChange={(outputDb) => patch({ outputDb })}
                />
              </KnobRow>

              <Row
                label="Limiter"
                enabled={keys.limiter.enabled}
                accent={colour}
                onToggle={() => patch({ limiter: { ...keys.limiter, enabled: !keys.limiter.enabled } })}
                hint="Brickwall safety limiter."
              />
              <KnobRow>
                <Knob
                  label="Ceiling"
                  value={keys.limiter.ceilingDb}
                  min={-12}
                  max={0}
                  step={0.1}
                  accent={colour}
                  disabled={!keys.limiter.enabled}
                  readout={`${keys.limiter.ceilingDb.toFixed(1)}dB`}
                  onChange={(ceilingDb) => patch({ limiter: { ...keys.limiter, ceilingDb } })}
                />
              </KnobRow>
            </Block>
          </div>
        </div>
      </div>
    </Panel>
  );
}
