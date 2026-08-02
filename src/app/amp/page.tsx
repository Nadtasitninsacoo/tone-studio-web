import { AmpWorkspace } from '@/components/amp/AmpWorkspace';

/**
 * Tone route.
 *
 * The amp, the cabinet, the mastering section and the tone assistant, split off the
 * recorder page so that page is only transport, tuner and takes. Everything here
 * drives the same engines through the shared store in `lib/ampStore.ts`, so the two
 * pages — and the jam page's own graph — stay in step in real time.
 *
 * A Server Component wrapper like the other routes; all interactivity is inside the
 * client-side <AmpWorkspace />.
 */
export default function AmpPage() {
  return <AmpWorkspace />;
}
