import type { MetadataRoute } from 'next';

/**
 * The web app manifest — what makes this installable.
 *
 * ---------------------------------------------------------------------------
 * A metadata route, not a static file in `public/`.
 *
 * Next generates `/manifest.webmanifest` from this and links it in every page's
 * `<head>` itself, so the file and the tag cannot drift apart. It is also the only
 * form in which the manifest is type-checked: a misspelled `display` value in a
 * hand-written JSON file is a silently non-installable app, and the failure shows up
 * as an install button that never appears rather than as an error.
 *
 * What each field is actually load-bearing for:
 *
 * - **`display: 'standalone'`** is the install. Without it the browser has nothing to
 *   install *to* — the app would open in a tab like any other page.
 * - **`start_url: '/'`** is the recorder, not the rig page. An installed app opens
 *   where a session starts: plug in, arm an input, tune.
 * - **A 192 and a 512 icon are both required** by Chrome's install criteria, and the
 *   `maskable` one is separate on purpose. Android crops an icon to whatever shape
 *   the launcher uses; a rounded square cropped to a circle loses its corners, so the
 *   maskable version is drawn full-bleed with the mark inside the 40% safe zone. Both
 *   are listed because a platform that does not understand `maskable` must still find
 *   an icon it can use.
 * - **`background_color`** is the splash screen while the app boots, and it matches
 *   `--c-base` in the dark theme rather than white. A white flash before a dark app
 *   is the one thing the pre-paint theme script in `layout.tsx` exists to prevent,
 *   and an installed app would have reintroduced it.
 *
 * One thing this cannot fix, and the most common reason a deployment is not
 * installable: **it must be served over HTTPS.** That is also non-negotiable for the
 * app to work at all — `getUserMedia` is refused on plain HTTP everywhere except
 * `localhost`, so an HTTP deployment has no microphone, no input and no takes.
 * ---------------------------------------------------------------------------
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tone Studio',
    // Under about 12 characters, or a launcher truncates it. This is the label under
    // the icon, so it has to survive being read at a glance. 'Tone Studio' is 11.
    short_name: 'Tone Studio',
    description:
      'Lossless multi-take recorder, tuner, six instrument rigs and a mixing desk for a USB audio interface.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0a0b14',
    theme_color: '#0a0b14',
    categories: ['music', 'productivity', 'utilities'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Long-press the installed icon to land on a page directly. The three routes the
    // app has, minus the one `start_url` already covers.
    shortcuts: [
      { name: 'Rig', short_name: 'Rig', url: '/amp', description: 'Six instrument racks' },
      { name: 'Mixer', short_name: 'Mixer', url: '/mixer', description: 'Audio & DSP Processor' },
    ],
  };
}
