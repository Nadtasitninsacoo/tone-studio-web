import { MixerWorkspace } from '@/components/mixer/MixerWorkspace';

/**
 * Mixer / Neural Audio Processor route.
 *
 * Renders the client-side <MixerWorkspace /> showing the 8-channel console
 * and the DSP crossover/phase-alignment tools.
 */
export default function MixerPage() {
  return <MixerWorkspace />;
}
