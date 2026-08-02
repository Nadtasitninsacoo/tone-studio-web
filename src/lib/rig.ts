/**
 * The rig: which instrument is plugged in, and the settings for all channels.
 *
 * ---------------------------------------------------------------------------
 * One interface, multiple chains, one call site.
 *
 * `useRecorder` builds a chain, hangs it on the monitor path and pushes settings
 * into it. It has no business knowing whether that chain is a guitar amp, a bass rig,
 * a drum bus, a vocal channel, keyboards or a brass rack — so all expose the same
 * four members, and `createRigChain` dispatches. Switching instruments then means
 * disposing one chain and building another.
 * ---------------------------------------------------------------------------
 */

import { createAmpChain, DEFAULT_AMP, type AmpSettings } from '@/lib/ampFx';
import { createBassChain, DEFAULT_BASS, type BassSettings } from '@/lib/bassFx';
import { createDrumChain, DEFAULT_DRUMS, type DrumSettings } from '@/lib/drumFx';
import { createVocalChain, DEFAULT_VOCALS, type VocalSettings } from '@/lib/vocalFx';
import { createKeysChain, DEFAULT_KEYS, type KeysSettings } from '@/lib/keysFx';
import { createBrassChain, DEFAULT_BRASS, type BrassSettings } from '@/lib/brassFx';

export type Instrument = 'guitar' | 'bass' | 'drums' | 'vocals' | 'keys' | 'brass';

export const INSTRUMENTS: readonly Instrument[] = ['guitar', 'bass', 'drums', 'vocals', 'keys', 'brass'];

export interface InstrumentInfo {
  id: Instrument;
  /** Thai label, as the switcher shows it. */
  label: string;
  latin: string;
  /** One line on what the chain is, not on what the instrument is. */
  hint: string;
}

export const INSTRUMENT_INFO: Record<Instrument, InstrumentInfo> = {
  guitar: {
    id: 'guitar',
    label: 'กีตาร์',
    latin: 'Guitar',
    hint: 'แอมป์ครบชุด — วาล์วซ้อนสามสเตจ ตู้ 4×12 และลิมิเตอร์',
  },
  bass: {
    id: 'bass',
    label: 'เบส',
    latin: 'Bass',
    hint: 'แยกย่านที่ครอสโอเวอร์ — เบสใสไว้ ขับแค่ย่านสูง มี DI ผสม',
  },
  drums: {
    id: 'drums',
    label: 'กลองชุด',
    latin: 'Drum kit',
    hint: 'บัสกลอง — เกต อีคิว ทางขนานอัดหนัก ห้อง และกลู',
  },
  vocals: {
    id: 'vocals',
    label: 'ร้องนำ',
    latin: 'Vocals',
    hint: 'ช่องเสียงร้อง — เกต, ดีเอสเซอร์, คอมเพรสเซอร์, อีคิว, ดีเลย์ และรีเวิร์บ',
  },
  keys: {
    id: 'keys',
    label: 'คีย์บอร์ด',
    latin: 'Keys/Synth',
    hint: 'ช่องคีย์บอร์ด/เปียโน — โครัสสเตอริโอ, คอมเพรสเซอร์, อีคิว และรีเวิร์บ',
  },
  brass: {
    id: 'brass',
    label: 'เครื่องเป่า',
    latin: 'Brass/Winds',
    hint: 'ช่องเครื่องเป่า — คอมเพรสเซอร์เกลี่ยหัวเสียง, อีคิวเป่าพุ่ง, ดีเลย์ และรีเวิร์บ',
  },
};

/** Every instrument's settings, kept side by side so switching loses nothing. */
export interface RigSettings {
  guitar: AmpSettings;
  bass: BassSettings;
  drums: DrumSettings;
  vocals: VocalSettings;
  keys: KeysSettings;
  brass: BrassSettings;
}

export const DEFAULT_RIG: RigSettings = {
  guitar: DEFAULT_AMP,
  bass: DEFAULT_BASS,
  drums: DEFAULT_DRUMS,
  vocals: DEFAULT_VOCALS,
  keys: DEFAULT_KEYS,
  brass: DEFAULT_BRASS,
};

/**
 * What the engine holds. Satisfied by all chains.
 */
export interface RigChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(rig: RigSettings): void;
  onMeter(handler: (source: 'gate' | 'limiter', reductionDb: number) => void): void;
  disconnect(): void;
}

/**
 * Build the chain for one instrument.
 */
export function createRigChain(
  ctx: BaseAudioContext,
  instrument: Instrument,
  rig: RigSettings,
): RigChain {
  if (instrument === 'bass') {
    const chain = createBassChain(ctx, rig.bass);
    return {
      input: chain.input,
      output: chain.output,
      update: (next) => chain.update(next.bass),
      onMeter: chain.onMeter,
      disconnect: chain.disconnect,
    };
  }

  if (instrument === 'drums') {
    const chain = createDrumChain(ctx, rig.drums);
    return {
      input: chain.input,
      output: chain.output,
      update: (next) => chain.update(next.drums),
      onMeter: chain.onMeter,
      disconnect: chain.disconnect,
    };
  }

  if (instrument === 'vocals') {
    const chain = createVocalChain(ctx, rig.vocals);
    return {
      input: chain.input,
      output: chain.output,
      update: (next) => chain.update(next.vocals),
      onMeter: chain.onMeter,
      disconnect: chain.disconnect,
    };
  }

  if (instrument === 'keys') {
    const chain = createKeysChain(ctx, rig.keys);
    return {
      input: chain.input,
      output: chain.output,
      update: (next) => chain.update(next.keys),
      onMeter: chain.onMeter,
      disconnect: chain.disconnect,
    };
  }

  if (instrument === 'brass') {
    const chain = createBrassChain(ctx, rig.brass);
    return {
      input: chain.input,
      output: chain.output,
      update: (next) => chain.update(next.brass),
      onMeter: chain.onMeter,
      disconnect: chain.disconnect,
    };
  }

  const chain = createAmpChain(ctx, rig.guitar);
  return {
    input: chain.input,
    output: chain.output,
    update: (next) => chain.update(next.guitar),
    onMeter: chain.onMeter,
    disconnect: chain.disconnect,
  };
}
