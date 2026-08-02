'use client';

import { Drum } from 'lucide-react';
import type { RefObject } from 'react';

import { Knob } from '@/components/ui/Knob';
import { Chip, Panel } from '@/components/ui/Panel';
import { useAccent } from '@/hooks/useAccent';
import { DRUM_EQ_HZ, DRUM_PRESETS, type DrumSettings } from '@/lib/drumFx';

import { ToneAssistant } from '@/components/recorder/ToneAssistant';
import { DRUM_LEXICON } from '@/lib/rigLexicon';

import { Block, BypassSwitch, GainReduction, KnobRow, Legend, Row, signed } from './RackParts';

interface DrumRackProps {
  drums: DrumSettings;
  onChange: (drums: DrumSettings) => void;
  isEnabled: boolean;
  onToggle: () => void;
  limiterReductionRef: RefObject<number>;
  gateReductionRef: RefObject<number>;
  isArmed: boolean;
}

/**
 * DrumRack — the drum bus.
 *
 * ---------------------------------------------------------------------------
 * Why Punch is not a compressor knob.
 *
 * It is the level of a **crushed parallel copy**, added underneath a dry path that
 * stays at unity. That is the whole trick of a drum bus and it is the opposite of
 * what the name suggests: a compressor in series makes a kit quieter, because the
 * transients are what "loud" means on a drum and a compressor removes exactly those.
 * The copy supplies body and room; the untouched original keeps every stick hit.
 *
 * So `Punch` can only add. At 0 the bus is the dry signal through the EQ and the
 * saturation; at 100 there is a heavily squashed version sitting under it at equal
 * level. Nothing in between attenuates the original, which is why it cannot be used
 * to make the kit smaller — the Output knob is for that.
 *
 * `Glue` is the other one, and it *is* in series: gentle, slow, after the blend.
 * See `lib/drumFx.ts`.
 * ---------------------------------------------------------------------------
 */
export function DrumRack({
  drums,
  onChange,
  isEnabled,
  onToggle,
  limiterReductionRef,
  gateReductionRef,
  isArmed,
}: DrumRackProps) {
  const patch = (change: Partial<DrumSettings>) => onChange({ ...drums, ...change });
  const { accent } = useAccent();
  const colour = accent.colour;
  const isLive = isEnabled && isArmed;

  const selected = {
    borderColor: colour,
    color: colour,
    backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`,
  };

  const activePreset = DRUM_PRESETS.find(
    (preset) => JSON.stringify(preset.settings) === JSON.stringify(drums),
  );

  return (
    <Panel
      title="Drum Bus"
      icon={<Drum aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone={isEnabled ? 'strong' : 'muted'} title="ใช้กับการมอนิเตอร์ ไม่ถูกบันทึกลงไฟล์">
            monitor only
          </Chip>
          <GainReduction
            label="GR"
            reductionRef={limiterReductionRef}
            active={isLive && drums.limiter.enabled}
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
          {/* ---- Column 1: presets, then what comes in --------------------- */}
          <div className="flex flex-col gap-2.5">
            <section>
              <Legend>Preset</Legend>
              <div className="flex flex-wrap gap-1.5">
                {DRUM_PRESETS.map((preset) => (
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
                  value={drums.inputDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(drums.inputDb)}
                  hint="Trim before everything. The compressors below listen to this."
                  onChange={(inputDb) => patch({ inputDb })}
                />
              </KnobRow>

              <Row
                label="Gate"
                enabled={drums.gate.enabled}
                accent={colour}
                onToggle={() => patch({ gate: { ...drums.gate, enabled: !drums.gate.enabled } })}
                hint="Off by default: on a kit the decay between hits is the room, and gating it away is a choice rather than a cleanup."
              >
                <GainReduction
                  label=""
                  reductionRef={gateReductionRef}
                  active={isLive && drums.gate.enabled}
                />
              </Row>
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={drums.gate.thresholdDb}
                  min={-80}
                  max={-20}
                  step={1}
                  accent={colour}
                  disabled={!drums.gate.enabled}
                  readout={`${drums.gate.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ gate: { ...drums.gate, thresholdDb } })}
                />
              </KnobRow>
            </Block>

            {/* Same assistant as the guitar rack, reading this instrument's lexicon:
                "หนาขึ้น" moves the controls that mean thickness *here*. See
                `lib/rigLexicon.ts`. */}
            <ToneAssistant
              settings={drums}
              onChange={onChange}
              lexicon={DRUM_LEXICON}
              instrument="drums"
              accent={colour}
              isLive={isLive}
            />
          </div>

          {/* ---- Column 2: shape it, then glue it -------------------------- */}
          <div className="flex flex-col gap-2.5">
            <Block name="EQ">
              <KnobRow>
                <Knob
                  label="Kick"
                  value={drums.eq.kickDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(drums.eq.kickDb)}
                  hint={`${DRUM_EQ_HZ.kick} Hz — whether the kick is felt.`}
                  onChange={(kickDb) => patch({ eq: { ...drums.eq, kickDb } })}
                />
                <Knob
                  label="Box"
                  value={drums.eq.boxDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(drums.eq.boxDb)}
                  hint={`${DRUM_EQ_HZ.box} Hz — the cardboard a small room puts around a snare. Almost always a cut.`}
                  onChange={(boxDb) => patch({ eq: { ...drums.eq, boxDb } })}
                />
                <Knob
                  label="Snap"
                  value={drums.eq.snapDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(drums.eq.snapDb)}
                  hint={`${DRUM_EQ_HZ.snap} Hz — the stick hitting the head.`}
                  onChange={(snapDb) => patch({ eq: { ...drums.eq, snapDb } })}
                />
              </KnobRow>
              <p className="text-[9px] leading-snug text-ink-3">
                Before the compressors, not after. A compressor reacts to what it is fed, so
                cutting the 400&nbsp;Hz box first means the crushed copy is not triggered by
                the problem being removed.
              </p>

              <Row
                label="Saturation"
                enabled={drums.drive.enabled}
                accent={colour}
                onToggle={() => patch({ drive: { ...drums.drive, enabled: !drums.drive.enabled } })}
                hint="Glue, not dirt — the curve is gentler than either of the other racks'."
              />
              <KnobRow>
                <Knob
                  label="Amount"
                  value={drums.drive.amount}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!drums.drive.enabled}
                  readout={`${Math.round(drums.drive.amount * 100)}%`}
                  onChange={(amount) => patch({ drive: { ...drums.drive, amount } })}
                />
              </KnobRow>
            </Block>

            <Block name="Glue">
              <Row
                label="Bus comp"
                enabled={drums.glue.enabled}
                accent={colour}
                onToggle={() => patch({ glue: { ...drums.glue, enabled: !drums.glue.enabled } })}
                hint="In series, after the blend. Slow and gentle — this is the one that makes a kit sound like one instrument."
              />
              <KnobRow>
                <Knob
                  label="Thresh"
                  value={drums.glue.thresholdDb}
                  min={-48}
                  max={0}
                  step={1}
                  accent={colour}
                  disabled={!drums.glue.enabled}
                  readout={`${drums.glue.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ glue: { ...drums.glue, thresholdDb } })}
                />
                <Knob
                  label="Ratio"
                  value={drums.glue.ratio}
                  min={1}
                  max={12}
                  step={0.5}
                  accent={colour}
                  disabled={!drums.glue.enabled}
                  readout={`${drums.glue.ratio}:1`}
                  onChange={(ratio) => patch({ glue: { ...drums.glue, ratio } })}
                />
              </KnobRow>
            </Block>
          </div>

          {/* ---- Column 3: the parallel path, the room, the output --------- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Parallel">
              <Row
                label="Crush"
                enabled={drums.crush.enabled}
                accent={colour}
                onToggle={() => patch({ crush: { ...drums.crush, enabled: !drums.crush.enabled } })}
                hint="A copy of the bus, squashed hard. Blended underneath the dry path — never in place of it."
              />
              <KnobRow>
                <Knob
                  label="Punch"
                  value={drums.punch}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!drums.crush.enabled}
                  readout={`${Math.round(drums.punch * 100)}%`}
                  hint="How much of the crushed copy is added. It can only add — the dry path stays at unity."
                  onChange={(punch) => patch({ punch })}
                />
                <Knob
                  label="Thresh"
                  value={drums.crush.thresholdDb}
                  min={-48}
                  max={0}
                  step={1}
                  accent={colour}
                  disabled={!drums.crush.enabled}
                  readout={`${drums.crush.thresholdDb}dB`}
                  onChange={(thresholdDb) => patch({ crush: { ...drums.crush, thresholdDb } })}
                />
                <Knob
                  label="Ratio"
                  value={drums.crush.ratio}
                  min={1}
                  max={20}
                  step={0.5}
                  accent={colour}
                  disabled={!drums.crush.enabled}
                  readout={`${drums.crush.ratio}:1`}
                  hint="Set far harder than anything in the other racks. This copy is meant to be crushed."
                  onChange={(ratio) => patch({ crush: { ...drums.crush, ratio } })}
                />
              </KnobRow>
              <p className="text-[9px] leading-snug text-ink-3">
                Turn <strong className="font-semibold text-ink-2">Punch</strong> up and the kit
                gets bigger without the stick hits getting quieter. That is the difference
                between parallel and series compression, and it is the whole reason this block
                exists.
              </p>
            </Block>

            <Block name="Room & out">
              <Row
                label="Room"
                enabled={drums.room.enabled}
                accent={colour}
                onToggle={() => patch({ room: { ...drums.room, enabled: !drums.room.enabled } })}
                hint="Short stereo convolution, in parallel. A kit with no room sounds like samples."
              />
              <KnobRow>
                <Knob
                  label="Size"
                  value={drums.room.sizeSec}
                  min={0.3}
                  max={5}
                  step={0.1}
                  accent={colour}
                  disabled={!drums.room.enabled}
                  readout={`${drums.room.sizeSec.toFixed(1)}s`}
                  onChange={(sizeSec) => patch({ room: { ...drums.room, sizeSec } })}
                />
                <Knob
                  label="Mix"
                  value={drums.room.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  accent={colour}
                  disabled={!drums.room.enabled}
                  readout={`${Math.round(drums.room.mix * 100)}%`}
                  onChange={(mix) => patch({ room: { ...drums.room, mix } })}
                />
              </KnobRow>

              <Row
                label="Limiter"
                enabled={drums.limiter.enabled}
                accent={colour}
                onToggle={() =>
                  patch({ limiter: { ...drums.limiter, enabled: !drums.limiter.enabled } })
                }
                hint="Look-ahead brickwall, last. A drum bus is all transients, which is exactly what a compressor cannot catch in time."
              />
              <KnobRow>
                <Knob
                  label="Output"
                  value={drums.outputDb}
                  min={-24}
                  max={24}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(drums.outputDb)}
                  onChange={(outputDb) => patch({ outputDb })}
                />
                <Knob
                  label="Ceiling"
                  value={drums.limiter.ceilingDb}
                  min={-12}
                  max={0}
                  step={0.1}
                  accent={colour}
                  disabled={!drums.limiter.enabled}
                  readout={`${drums.limiter.ceilingDb.toFixed(1)}dB`}
                  onChange={(ceilingDb) => patch({ limiter: { ...drums.limiter, ceilingDb } })}
                />
              </KnobRow>
            </Block>
          </div>
        </div>
      </div>
    </Panel>
  );
}
