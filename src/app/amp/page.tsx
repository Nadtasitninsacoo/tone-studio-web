import { AmpWorkspace } from '@/components/amp/AmpWorkspace';

/**
 * Rig route — labelled "Rig" in the nav, still served at `/amp`.
 *
 * The path is the older name and is deliberately left alone: it is in the manifest's
 * shortcuts, in anything anyone has bookmarked, and in an installed app's shortcut
 * list. A rename would break all three to fix a word nobody sees. "Tone" moved up to
 * become the name of the whole app instead, and one word cannot mean both.
 *
 * The six racks, the cabinet, the mastering section and the tone assistant, split off
 * the recorder page so that page is only transport, tuner and takes. Everything here
 * drives the same engines through the shared store in `lib/ampStore.ts`, so the two
 * pages stay in step in real time.
 *
 * A Server Component wrapper like the other routes; all interactivity is inside the
 * client-side <AmpWorkspace />.
 */
export default function AmpPage() {
  return <AmpWorkspace />;
}
