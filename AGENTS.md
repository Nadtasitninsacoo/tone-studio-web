<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Tone Studio web — rules for agents

Read [README.md](README.md) for the architecture and the design rules; both
record decisions that were expensive to arrive at. This file is the short list of
things that break silently.

## "Tone" means the app now, not the page

The project was `guitar-recorder-web` until it grew five more instruments; it is
**Tone Studio** (`tone-studio-web`). One consequence is worth knowing before reading
anything else here, because the vocabulary is deliberately inconsistent:

| you will read | it means |
|---|---|
| **Tone Studio** | the whole app |
| the **Rig** page | what the nav calls `/amp` — six racks, cabinet, assistant |
| "the tone page", `route === 'tone'`, `monitorScope` | the same page, older name, **still correct in code** |
| `/amp`, `ampStore`, `AmpRack`, `AmpWorkspace` | also that page, older still |

Three names for one route is not drift to tidy up. The **path** is in the manifest's
shortcuts and in anything anyone has bookmarked or installed; the **identifiers** are
load-bearing across `StudioProviders`, `lib/ampStore.ts` and both engines, and the
route group `'tone'` in particular is what the handover watcher keys on — see the rule
about `/` and `/amp` both being scope `recorder`. Renaming any of it to match the label
would break working things to fix a word nobody sees. Only the **label** moved.

## This app stands alone

This directory is the whole project and its own git repository. There is no
parent project, no workspace, no shared `node_modules`. The API is reached only
over HTTP at `NEXT_PUBLIC_API_URL` — never reach outside this root to find it, and
do not import from, write to, or generate files in the server's directory,
wherever it happens to be checked out.

The response types in [src/lib/api.ts](src/lib/api.ts) are a **mirror** of the
server's contract, not the source of truth. The server owns it. Nothing here will
fail to compile when the server changes, so treat a contract change as a manual
sync.

Every call must keep degrading gracefully when the variable is unset —
`isApiConfigured` exists so the app stays usable with session-local takes rather
than hard-failing without a server.

## There is no video editor

`/editor` — a two-track NLE with drag-and-drop, trimming, ripple delete, an IndexedDB
draft and its own mixdown — was **removed on request**, and so was `/jam`. What went
with the editor: `useEditor`, `useAssetDrag`, `components/editor/`,
`lib/editorDraft.ts`, `lib/mixdown.ts`, `lib/tabCapture.ts`, and then
`lib/timeline.ts` + `types/editor.ts` once the video exporter that had been keeping
that model alive went with the jam page.

The routes are `/` (recorder), `/amp` (tone), `/mixer` and `api/tone`. **There is no timeline,
no clip, no project and no video anywhere in this app.** If a task seems to need one,
that is a new feature, not a restoration — say so rather than reviving 4,000 lines
from an earlier shape of the project.

What survives both pages is the reasoning. Several rules below were learned there and
still apply to anything that plays or records: the AudioContext clock owns the
playhead, an undecodable source is skippable rather than fatal, and a capability
probe must never run during render.

## The mixer

Being built. Two halves, wired together:

- **The engine** — `types/mixer.ts`, `lib/mixer.ts`, `lib/mixGraph.ts`,
  `hooks/useMixer.ts`. Channels → subgroups → master, clips or the live input per
  channel, per-channel time offset with no clip model, and an offline WAV/MP3 render
  through the *same* `buildMixGraph` as the live path. 42 Node checks on the pure half.
- **The console** — `app/mixer/`, `components/mixer/`. An 8-strip desk plus DSP
  crossover and phase views, wired to the engine: every strip is one of its channels,
  `MixerTransport` carries the input picker, the transport and the render, and
  `MixerSourceRow` is what assigns a source to a strip.

Things to know before touching either:

- `buildMixGraph` takes a **`BaseAudioContext`** so the live path and the offline
  render are one description instantiated twice. Building the render's arrangement
  separately is how "the mix I heard" and "the file I got" start to differ.
- The master limiter is built from **`DEFAULT_AMP`**, never from the live amp
  settings. Spreading those would put the guitarist's input trim, output trim and
  tone stack (+2 dB bass, +2 dB treble by default) across the whole mix, and dialling
  the amp would change the master.
- Solo/mute is resolved in **one** function, `audibleChannelIds`, across both tiers,
  and `audibleGroupIds` is derived from its result. Two functions deciding
  independently is how a soloed channel inside a muted group ends up silent with both
  of them believing they were right. The 64-combination invariant is checked.
- A channel's level is **one `AudioParam` written from one place** —
  `fader × (audible ? 1 : 0)`. Same rule as the recorder's six racks.
- `needsRebuild` is the only thing that decides whether a change needs new nodes.
  Only an insert change, a group change or a source-kind change does; a fader drag at
  60 fps must never rebuild.
- Every route is prerendered, so **`useSyncExternalStore` needs its third argument**.
  Without it, `next build` fails on that page with "Missing getServerSnapshot" — it
  does not degrade to client rendering. `lib/ampStore.ts` exports a server snapshot
  for every value.

## Tailwind is v4, not v3

There is no `tailwind.config.js`. Tokens live in `@theme` / `@theme inline` inside
`globals.css`. Canonical class names differ from v3:

| v4 | not |
|---|---|
| `bg-linear-to-b` | `bg-gradient-to-b` |
| `h-6!` | `!h-6` |
| `h-dvh` | `h-[100dvh]` |
| `h-(--var)` | `h-[var(--var)]` |

## Lint is strict, and two rules bite constantly

- **`react-hooks/refs`** — never return a raw ref object from a hook; return a
  callback ref instead. Any member read on an object containing a ref is flagged.
  See `useJam.setVideoElement`.
- **`react-hooks/set-state-in-effect`** — never call `setState` synchronously in
  an effect body. Use `useSyncExternalStore` (see `lib/theme.ts`) or set state
  after an `await`.

And one that lint cannot catch: **never call a browser capability probe during
render** (`canExportVideo()`, `canCaptureTab()`, anything reading `navigator` or
`MediaRecorder`). Every route here is prerendered, so the server renders the
button disabled with its "unsupported" tooltip and the client renders it enabled —
a hydration mismatch React reports and cannot patch up for attributes. Route them
through `useClientCapability`, which hands SSR and hydration the same answer and
lets React re-render with the real one. The flags are `false` for the first paint
by design.

## Do not undo these

- **One `getUserMedia` per device, shared through `lib/inputSession`.** Both engines
  hold a `clone()`; the device closes when the last holder releases it. `useRecorder`
  is armed from app start, so arming the jam page used to open the same pedal twice —
  and a class-compliant USB interface can answer that by resetting its endpoint,
  which ends the first stream. Never call `track.stop()` on an input stream again;
  call `lease.release()`.
- **A track firing `ended` is a transient, and must never close the `AudioContext`.**
  That is what "Input device disconnected." with nothing to press was: a USB glitch
  took monitoring, the meters, the tuner and the amp with it. The session reopens the
  same device and hands the stream back through `onStream`, where each engine
  re-points **one** source node — the graph, and therefore the tone, survives. Status
  `recovering` exists so this is not reported as `error`; red still means live or
  broken.
- **One device is one session, and `default` is not a device.** `''`, `'default'` and
  the hardware's own id all name the same input; keying sessions by the requested id
  meant the recorder holding `id-pedal` and the mixer holding `default` were two opens on
  one endpoint, which is the reset that ends the first stream — heard as "the sound came
  in for a second and then stopped". `resolveDefaultDeviceId` reads the alias's `groupId`
  to find the real id *without opening anything*, and `aliases` maps every requested id
  onto the session's canonical key.
- Re-finding a device by **id, then group, then label, and nothing else**. There is
  deliberately no "close enough" fallback: re-arming onto the laptop microphone would
  carry on recording, at a plausible level, from the wrong instrument.
- Keeping a take that a dropout cut short. It was captured against valid anchors up
  to that instant, so it is encoded and handed over with a neutral notice — except
  during the count-in, where the buffer is only clicks.
- The `lib/contextHealth` poll. A Windows endpoint reset either **suspends** the
  context (no event reaches page code, and nothing was resuming it) or leaves it
  reading `'running'` with a clock that has stopped, which raises nothing at all — so
  the clock is watched directly, twice a second. `resumeOnGesture` covers the
  autoplay policy refusing a programmatic `resume()`. Jam's stall rebuild keeps the
  layers because `AudioBuffer`s belong to no context, and it stops after a second
  stall inside 15 s rather than looping.
- Lossless PCM capture via the AudioWorklet, **not** `MediaRecorder` (which is
  lossy WebM/Opus).
- The worklet's 0-gain `GainNode` → `destination` path. Web Audio will not pull a
  node with no route to `destination`; removing it silently breaks capture.
- `echoCancellation` / `noiseSuppression` / `autoGainControl` all `false`.
- Meters and timecode painting from refs in one rAF loop. Moving them into React
  state re-renders the dashboard 60×/second.
- The AudioContext clock as the playhead, with the video slaved to it — never the
  reverse. (The editor page proved this one and is gone; `useJam` and the YouTube
  player both live by it.)
- Treating an undecodable source as skippable, not fatal. A video with no audio track
  is a normal import; failing the whole play or the whole mixdown over it is not.
  Name what was skipped.
- One shared `AudioContext` in `useJam` for backing playback *and* guitar
  capture. Two contexts drift and the take can never be placed correctly.
- Jam takes captured **dry**, tapped before the amp. The amp is applied on
  playback and mixdown instead, so it stays editable after the take.
- **One** guitar chain — `createAmpChain` — shared by both pages, cabinet included.
  The jam page used to have a second, smaller rack (`guitarFx.ts`, `fxGraph.ts`,
  `FxRack`, `FxBoard`, all deleted) for a guitar arriving from a multi-FX pedal with
  its cab already printed. A dry DI through that met no speaker anywhere, and a
  waveshaper with nothing to roll off its top is fizz. Writing a "simpler jam rack"
  rebuilds exactly what was removed: a sweetener is `cab` and `drive` switched off in
  the one rack, never a second chain on the same signal.
- `useJam`'s amp being **nullable**, and its failure reported to `notice`. The gate
  and limiter are worklet processors; a browser that refuses the module must still
  play the backing and the layers rather than lose the page over a tone chain.
- `renderMix` rebuilding the amp offline and **throwing** if it cannot. Rendering
  dry instead hands over a thin DI mix of a sound nobody heard, and it looks like a
  success. A node belongs to one context for life, so the live chain cannot be
  reused there.
- `clampAmp` between **every** untrusted source and `createAmpChain` — the model's
  reply, the `/api/tone` request body, a stored preset. It is total on purpose: never
  throws, never returns a partial object, falls back per field. Trusting a reply
  because it validated against a JSON schema does not help; structured outputs cannot
  express numeric bounds, so the schema permits `drive.amount: 4`.
- `ANTHROPIC_API_KEY` **without** a `NEXT_PUBLIC_` prefix, read inside the route
  handler and never at module scope. The prefix would inline the key into the browser
  bundle; module scope would evaluate it during `next build` and fail the build on a
  machine with no key.
- `/api/tone` answering a missing key with **503 `no-key`**, not 500, and the client
  falling back to the local engine silently. The feature is not broken when it is
  unconfigured, and a tone control that stops working because a server is down is a
  worse product than one that gets slightly less clever.
- The Thai direction model in `toneIntent.ts`. `ลง` means *less* after a control name
  ("เบสลง") and *more* after an adjective ("บางลง" is thinner, "เบาลง" is quieter), so
  only an explicit reducing verb flips a quality word. Collapsing the two into one
  word list double-negates, silently, and turns requests into their opposites — it did
  exactly that to five of them.
- `public/sw.js` staying **network-first, cache as fallback**, precaching nothing.
  Precaching a Next.js build serves a cached document that points at hashed chunks the
  next deploy replaced; the page then loads, fails to hydrate, and reloading serves the
  same cache. The only user-visible fix is clearing site data, which also destroys their
  take library.
- The service worker registering in **production only**. In `next dev` it stands between
  HMR and on-demand chunks, and produces "why is my edit not showing" bugs that read as
  build failures for an hour.
- `manifest.ts` as a metadata route, and the maskable icon being a **separate,
  full-bleed** entry. Android crops to the launcher's shape; a rounded square cropped to
  a circle loses its corners.
- The Thai keyword minimum of three characters in `matchPreset`. `สด` is inside
  `สวัสดี`, and a greeting used to select a drum voicing — Thai has no word separators,
  so a short keyword is a substring of ordinary words.
- **Local first, then Claude** — and the test is `residue`, not a guess. Sending
  every request to the model spent quota on "หนาขึ้นอีกนิด" and on every genre name,
  which the lexicon answers exactly and for free. Escalate only what it could not
  account for.
- **Thai matches on substrings, latin on word boundaries** (plus English inflections,
  so `bright` reaches "brighter"). Thai is written without spaces so a substring is
  the only possible match; treating latin the same way selected the pop preset for
  "popular request" and reduced the residue of "add some echo" to "dd so", because the
  fillers `a` and `me` were cut out of the words containing them.
- Fuzzy genre matching being **Thai-only, 4+ characters, anchored on the first two**.
  Latin keywords like `pop`, `lai` and `bend` are one edit from "top", "law" and
  "band", and a wrong genre applied confidently is worse than an admitted miss. The
  anchors are also what keeps it affordable: the unanchored version measured 177ms on
  a long prompt.
- Preset matching scoring **length before exactness**. `พิณ` is an exact keyword of
  `lai-phin` and sits inside "พิณกองยาง", so ranking exact matches first answered the
  wrong Isan mode to a misspelled one.
- Stripping a matched preset's keywords from the text before the rules read it. Genre
  names contain tone words: "พิณกองยาว" contains ยาว, which is the sustain rule, and
  left in it applied an adjustment on top of the preset that nobody asked for.
- The free accent hue being **numbers** — `--c-accent-hue` plus a lightness and a
  chroma per theme — with the colour built in `globals.css`. A JS-generated
  `oklch(...)` string carries one lightness, which cannot be right on both black and
  white. The tone properties are per theme (`-light` / `-dark`) because they are set
  inline on `<html>`, which outranks both theme blocks; one shared name would give
  the dark theme the light theme's lightness.
- Measuring chroma **per hue** (`accentTone`, `lib/oklch.ts`) instead of using one
  constant. The old constants sat outside sRGB for 30 of 72 hues in the light theme
  and 45 of 72 in the dark one, so the browser mapped half the wheel onto the gamut
  wall — pastel, with neighbouring degrees identical. sRGB is not a nice shape: at
  one lightness the most saturated violet is 3× the most saturated blue. "Simplify
  it back to one number" means going back to that.
- Nine hues, all nine exposed as Tailwind colours, and the picker's markers carrying
  the tokens' **measured** hues. `--c-amber` and `--c-pink` were tokens with no
  `--color-*` entry, so `text-amber` compiled to nothing at all — a token is not a
  colour until `@theme inline` emits it.
- Red staying at `#e01843` / `#ff3b5c` while the rest were re-saturated. It was
  already at 96% of the gamut edge — the one hue with nothing to gain — and it is
  the only semantic colour in the set.
- `AmpRack`'s six blocks in three explicit flex columns, two per column. Grid rows
  share a height and CSS multi-column always leaves the remainder in the last column
  (measured 690/800/450); both were tried, and the comment above the grid records why
  neither closed the gap. The tone assistant is a full-width strip below them, not a
  block in a column — it is not a stage in the chain, and at 420px tall nothing in a
  one-third column balances against it.
- `AmpRack`'s `scope` prop, and the `@container` query on its column grid. The rack
  is full width on the recorder and 240px in the jam rail — both `lg` viewports, so
  a viewport query put three columns of knobs into the rail. `scope` is what stops
  the jam copy claiming "monitor only" about a chain that is printed into the export.
- Subtracting latency from a jam take's offset — it moves the take **earlier**.
  Flipping the sign is silent and makes every overdub twice as late.
- A negative capture offset trimming the buffer head, not clamping to zero.
  Clamping keeps the count-in and drags the first note late by its whole length.
- Snapping the take's **first onset**, not its first sample.
- Jam layer trims moving `offsetSec` together with `inPoint`. Changing the
  in-point alone drags every remaining note earlier — a trim that also ruins the
  timing the rest of the page works to protect.
- `firstOnsetSec` measured from the **buffer**, not from `inPoint`, so trimming
  the head cannot silently invalidate it.
- The jam rails rendering at *every* breakpoint (sheets on phones, docked on
  desktop). Hiding a rail below `lg` would hide the input picker and the latency
  trim, leaving a phone unable to record.
- `useRecorder` and `useJam` being called **once, in
  `StudioProviders`**, above the router. Moving either of them back into its page
  restores the original bug: a route change unmounts the hook, the cleanup closes the
  AudioContext and revokes the object URLs, and playback stops with the video gone.
  `useRecorder` joined them when tone moved to `/amp` — with it on the dashboard,
  navigating to the tone page released the input, so the rack would have been dialling
  an amp nobody could hear and the takes would have gone with it.
- **The bass rig driving only the band above the crossover.** Distorting a bass
  fundamental replaces it with harmonics instead of adding to them -- the note gets
  smaller, which sounds fine on headphones and disappears on a phone. The crossover is
  Linkwitz-Riley (two cascaded sections per band) for the same reason `songFx` is: a
  single lowpass plus highpass at one corner sums to a null, and a bass rig with a hole
  at 150 Hz is a broken bass rig.
- **The drum bus's `Punch` being a parallel blend, not a series compressor.** The dry
  path stays at unity and the crushed copy is added underneath, so the control can only
  add. Rewiring it as a crossfade removes the transients that are the entire reason a
  drum sounds loud. Its EQ also stays *before* the compressors: they react to what they
  are fed, and cutting the 400 Hz box afterwards leaves the copy still triggered by it.
- Bass cabinets being separate models with `kind: 'bass'`, and both pickers filtering
  on it. A guitar 4x12 starts at 90 Hz and a bass 4x10 at 45; offering either in the
  other rack is offering a way to lose the instrument's own range.
- One `RigChain` interface for all three chains, dispatched in `lib/rig.ts`, with
  `update` taking the **whole** rig rather than one slot. That is what keeps
  `useRecorder` free of branches on which instrument is plugged in, and makes a chain
  reading someone else's settings impossible rather than merely unlikely.
- **All three chains alive in parallel, permanently**, with per-channel gain in
  `rigWet`. This replaced a rebuild-on-switch design, and the reason is worth keeping:
  rebuilding made changing tabs interrupt the sound, when the actual use is dialling
  three instruments and then playing with all of them running. "Off" is a gain of zero,
  not a teardown — a channel has to come back instantly and without a click. Two start
  off because the CPU cost is real, and the dry feed opens only when all three are off.
- The mixer's level and the channel's on/off writing **one** `AudioParam` from **one**
  effect. They multiply into a single gain, and two effects writing the same param
  fight over it.
- Selecting a rack and enabling a channel being **separate controls**. One changes what
  you see, the other changes what you hear; merging them is what made switching tabs
  silence an instrument.
- One `RigSettings` for the whole app, in `lib/ampStore.ts`. The recorder's monitor
  path, the jam page's playback and mixdown, and the `/amp` rack are three views of
  one value — giving any of them its own copy is a tone that disagrees with itself
  depending on where it was dialled. Both hooks also need the push-on-external-change
  effect: a change made on another page reaches them as a re-render, not as a call to
  their own `changeAmp`, so without it the graph keeps the tone it was built with
  while the rack shows a different one.
- The store **not** persisting to `localStorage`. A knob drag writes every frame, and
  `lib/ampPresets.ts` already exists for keeping a tone deliberately.
- The providers handing React the **same `children` element** on every render.
  Wrapping it, or moving the composition into a component that has its own state,
  turns each 60 fps playhead tick into a full-app re-render.
- `resumePicture` seeking **before** it plays. The element that comes back after a
  route change is at frame zero; playing first shows the wrong frame, and skipping
  it altogether leaves the picture advancing only by drift correction.
- The YouTube player being slaved to the AudioContext clock, never the reverse, and
  its 750 ms drift tolerance. Tightening it to the `<video>` value makes the song
  stutter continuously, because every correction is a re-buffering seek.
- `backingPlacement` doing the maths for **both** the live schedule and the offline
  mixdown. A captured YouTube backing starts at `backingOffsetSec`, not at zero, so
  the naive `start(when, from)` plays the captured stretch from the wrong point —
  and only for that source, so a file will keep working while you debug.
- Shifting `firstBeatSec` by `backingOffsetSec` when tempo is detected on a captured
  backing. `analyseBeats` measures from the buffer; everything downstream works in
  song time. Skip it and the grid, and every snapped take with it, lands wrong.
- The YouTube player staying muted once its audio has been captured
  (`hasCapturedBacking`). Unmuting it plays the song twice, once shaped and once not.
- A pasted YouTube link being explained through `notice`, not `error`. It plays, it
  takes overdubs, and only sample-level work is impossible — dressing that in red
  breaks "red means live or broken".
- The export buttons **not** being disabled by their capability probes. Feature
  detection can be pessimistic, a greyed-out button explains nothing, and a
  server-rendered `disabled` attribute is exactly what React refuses to patch up on
  hydration. The action re-checks and reports the specific reason instead.
- Tab capture refusing when the share has no audio track. Returning silence
  instead looks like success and wastes the whole realtime pass.
- Every `source.kind === 'youtube'` guard. That audio is not in our graph, so a
  mixdown silently omits it, tempo detection has nothing to read and the video
  exporter cannot read the frames at all. Removing a guard does not add a feature;
  it produces a file the user thinks contains the song.
- `encodeMp3` being `async` so LAME arrives via `import()`. Making it synchronous
  puts ~160 kB into the initial page load for a button most sessions never press.
- The import toast mounted with `key={lastImport.id}`, and a fresh id minted per
  import. Both halves are load-bearing: a stable id means importing the same file
  twice changes nothing observable, and without the key the second import inherits
  the first one's already-expiring dwell timer instead of restarting it.
- The Linkwitz-Riley (double-filter) crossover in `songFx`. A single lowpass plus
  a single highpass at one corner sums to a total null there — verified, not
  theoretical.
- The tuner **band-limiting a longer block than it analyses**. The filters start
  from zero state and ring; done in place on the window alone that ringing lands
  on its front, where the autocorrelation is most sensitive. Measured at 0.95
  cents of error — twenty times the resolution the display claims. Warming the
  filter on the block's own tail instead is *worse* (8.0 cents), because the tail
  does not end on a period boundary.
- The tuner's noise gate being **relative to the input's own floor**, not a
  constant. Mains hum is periodic and scores a perfect clarity; a fixed gate
  reports it as a confident G1 on a bass. The estimator is a running minimum, not
  a smoothed average — an average cannot both catch up to a hum and avoid gating
  off a sustained note.
- Discarding pitch readings for the first 70 ms after an onset. A freshly plucked
  string genuinely *is* sharp — large excursion, more tension — by 5–30 cents.
  Averaging those readings in does not help, because they are biased rather than
  noisy.
- The median in front of the tuner's Kalman filter. The filter's innovation gate
  is what makes it follow a peg turn in 60 ms, and that is only safe because a
  single octave-slipped reading can never reach it.
- The tuner tapping the **dry** input, before the amp. Three valve stages and a
  compressor destroy exactly the two things the detector reads.
- `windowLengthFor` sizing the analysis window from the selected tuning. A guitar
  needs 2048 samples and a 5-string bass 8192; one window big enough for both
  costs 4× on every reading of the common case.
- **Exactly one side owns the live monitor** (`monitorScope` in `lib/ampStore.ts`, applied
  by each engine's single gain writer). Both engines processing the same input through
  their own racks is double the convolvers and worklets, and three live channels was enough
  to overrun the audio thread. Gain zero is not enough on the losing side: the recorder's
  monitor bus is **disconnected** from `destination`, because Web Audio stops computing a
  node with no path there, not one whose output is silent.
- **Ownership moves on a press, never on a navigation** — `MonitorHandover`, a button on
  each page, is the only writer of `monitorScope`, and `StudioProviders` only applies what
  it says. This replaced a watcher that read the route and gave the sound to whichever page
  was visible, and the replacement was asked for after using it: opening the mixer to glance
  at a fader silenced the rack you were dialling. The numbers were never at risk — they live
  in the shared store — but a tone is built *by ear* over minutes, and losing the listening
  to a click on a nav item is indistinguishable, in the moment, from the monitor breaking.
  So navigating is not a request to change the sound.
  - Taking the sound also **opens the Monitor switch**, once, on the transition, and only
    when `previous !== null` — the first pass is the page loading, not a handover. That
    guard is the whole feedback argument: nothing opens a speaker without a person pressing
    something, on any page. It waits for `status` to leave `arming` before opening, because
    a press can land while `getUserMedia` is still resolving and deciding then decides
    against a signal one moment away.
  - `/` and `/amp` are **one side**. Both render the same control, and pressing either
    brings the sound back from the desk; there is no handover *between* them to make.
- **The desk parking its whole `AudioContext`** when it owns neither the live monitor nor a
  transport (`shouldParkContext`, checked). Muting its channels was not enough for the same
  reason gain zero was not enough for the recorder's monitor bus: a silent graph is still a
  computed graph, so the desk went on running a rig chain per live channel, on a second
  render thread, beside the tone page's own chains for the same instrument. A desk has eight
  strips and no single bus to unhook, so `suspend()` — which stops every node at once — is
  the answer instead. Both watchers in `lib/contextHealth` take an `isParked` predicate,
  because a deliberate suspend is otherwise indistinguishable from the failure they exist to
  fix: the poll would resume it within 500 ms and the gesture listener on the next keystroke.
- **`MONITOR_LATENCY_HINT`, and never `'interactive'` again.** `'interactive'` asks for the
  smallest buffer the machine will give — 128 frames, ~3 ms — and that was right when this
  was one guitar through one rack. Six chains do not fit in it: the render thread has to
  finish six gates, six limiters, two convolvers and six oversampled waveshapers inside
  every quantum, and when it cannot, the output stream **gives up and stays silent**. Not
  glitchy — silent, permanently, while `ctx.state` reads `'running'`, the clock keeps
  advancing, the monitor bus is connected and every gain is 1.0. The desk had already
  learned this and written it down (`useMixer.ts` predicts "a stutter, and then silence when
  the output stream gives up"); the recorder was left at 3 ms because the comment said one
  rack, and nobody updated it when the rack became six. A whole day went into the amp graph,
  the monitor scope, `setSinkId`, the USB pedal and Windows' audio routing before the
  question that solved it — *"why can I hear the mixer page, then?"* Both contexts held a
  `getUserMedia` source node. Only the buffer differed.
- **A channel that is off is disconnected from `mixBus`, not merely turned down.** Same rule
  as the monitor bus one line up, one level down, and it is what buys the low buffer back:
  Web Audio runs a node if it has a path to `destination`, not if it is audible, so six
  attached-but-silent chains cost exactly as much as six loud ones. The nodes, their
  parameters and the dialled tone are all untouched — this is not the rebuild-on-switch
  design that was removed, and a channel still comes back instantly and without a click.
  Order is load-bearing in both directions: connect *then* ramp up, ramp down *then*
  disconnect after 80 ms. `arm` attaches only the channels that are already on, because
  otherwise every arm — including every device recovery — starts at the full six-chain load,
  which is the load the stream gives up under.
- `toggleInstrument` writing **nothing but the store**. It used to set the gain directly as
  well, so the switch felt instant rather than a render later. That stopped being safe when
  a channel started leaving the graph: gain and connection now have to move together and in
  order, and a second writer racing the effect either clicks or attaches a node whose gain is
  already up. One `AudioParam`, one writer — the frame of latency is inaudible against a
  20 ms ramp.
- The **two test tones** in `OutputPicker`, and the fact that they are two *buttons*. Button
  one plays an oscillator straight into the engine context's `destination` — around the amp,
  around the monitor gain, around everything a rack could break. Button two plays the same
  tone on a throwaway context that has never touched the mic. Everything above was found by
  the pair disagreeing, and nothing else could have found it: every reading on the screen was
  correct while the page was silent. Firing both from one press was tried first and measured
  nothing — asking a listener to tell 440 Hz from 660 Hz a second apart returns "one beep".
- The output device picker staying, even though `setSinkId` turned out not to be the answer.
  It is honest — the readout prints the sink the context actually reports — and ruling the
  output device out took three of them.
- `RigMixer`'s carrier line checking the **live feed before the desk**. A rack row that
  reports an empty mixer channel while this engine is carrying the input prints
  "ไม่มีสัญญาณ" a few centimetres from meters reading −1.6 dBFS. That is not a confusing
  message, it is a false one, and it sent a debugging session after a missing signal when
  the answer was a muted monitor switch.

## Before claiming anything works

Bluetooth detection, MP3 export, **the tuner** and **the entire mixer** have **never
run in a real browser**. Ask the user to test or drive a browser; do not report them
as working.

**The mixer's live monitor has now made a sound** — that is all of it that has. The desk
was audible on `/mixer` through a live channel while the Rig page was silent, and that
contrast is what identified the buffer bug. Still unheard, and still not to be reported as
working: playback of a clip on a channel, the offline render, solo/mute across the two
tiers, and any strip meter. Its pure half — the fader and trim laws, the equal-power pan,
the placement arithmetic, the two-tier solo/mute and `needsRebuild` — has 42 Node checks
and can be reported as checked.

**The device-recovery path has now run for real, repeatedly, and it worked.** In one
session a class-compliant USB pedal fired `ended` five times; `pickReplacement` failed by
id, by group and by label while the device was genuinely absent from the enumeration, the
backoff kept going, and it reopened on attempt 2 or 3 each time. `swapSource` absorbed
every replacement — the meters and the limiter's gain reduction never stopped reading, so
the graph and the dialled tone survived as designed. **Two `AudioContext`s reading clones
of one device stream is verified**: the recorder and the desk both carried live audio off
the same lease. The pedal's `groupId` changed on every re-enumeration (four distinct values
in one session) while its `deviceId` held, which is exactly why the group fallback exists.
Still unobserved: `mute`/`unmute`, a stalled or suspended context, and a salvaged take.

The **bass rig and the drum bus have never made a sound.** Their data is checked (374
assertions across two suites) and their graphs type-check, but no `AudioContext` has
ever built either one: the crossover's null-free sum, the parallel blend's level, the
DI's equal-power crossfade, and the three channels mixing together with their faders
are all unheard. Report the presets and the lexicons as reasoned and checked, and the
audio as untested.

The **install path has never been exercised either.** The manifest and the icons are
generated and served — `/manifest.webmanifest` builds as a route, the four PNGs decode
— but nothing has been installed from them, and a service worker cannot register over
plain HTTP, so `public/sw.js` has never run at all. It needs an HTTPS deployment before
any of it can be called working.

The **tone assistant's Claude path has never run.** There is no `ANTHROPIC_API_KEY`
on this machine and no `ant` profile either, so `/api/tone` has only ever been
exercised down its no-key branch — verified returning `503 no-key`. The request shape,
the `output_config.format` schema, the refusal branch and the SDK error mapping are
type-checked and unexercised. The **local** engine, by contrast, has 244 Node checks
behind it; report the two differently.

The **amp** has now been heard, but only in the weakest sense that counts: signal reached
the speakers through the six-rack monitor path on the Rig page, cleanly and without
dropouts, after the buffer fix. Nobody has yet A/B'd a knob — whether DRIVE, the cabinet
choice or the tone stack actually change the sound the way the DSP says they should is
still unconfirmed, and so is the offline `renderMix` path, which builds the chain a second
time on an `OfflineAudioContext`. Report the monitor path as heard and the DSP as unjudged.

The tuner deserves its own note because its numbers are unusually good and
unusually narrow: every one of them comes from a synthesised signal. Real strings
are inharmonic, real rooms resonate, real notes decay. Report the maths as
checked and the instrument as untested.

### Verified in a real browser (Edge, Windows 11, USB audio class pedal)

The recorder's **input path** has now run for real. Confirmed from screenshots:
device enumeration and labelling, the permission flow, `arm()`, the AudioWorklet
loading from `/worklets/`, `48 kHz / stereo / SIGNAL OPEN`, the meters reading
−13.3 dBFS, the live waveform, and direct monitoring through `toggleMonitoring`.
The user reported a take recording successfully; that part was not seen directly,
so treat the WAV encoder's browser behaviour as reported, not observed.

Three things that session established, worth keeping:

- **The pedal enumerates as `Microphone (USB-Audio)`** — no brand name at all. So
  `TANK_G_PATTERN` in `useInputDevices` never matches and the Tank-G badge does not
  appear; `INTERFACE_PATTERN` does match on `usb`, so it still sorts to the top. The
  device reports USB `VID_4C4A&PID_C755`, which is the only reliable way to identify
  it.
- **`getUserMedia` failures are not all permission failures.** See
  `lib/mediaErrors.ts`. Reporting everything as "blocked" sent one debugging session
  at the OS when the answer was Edge's own per-site setting.
- **Monitoring is not what gets recorded on this machine.** The laptop's headphone
  output has a Dolby DAX3 APO in the chain, so the browser's output is
  post-processed while the captured WAV is dry. The meters read pre-monitor, so they
  tell the truth even when the ears do not.

A later session heard the following for the first time, on the same machine and pedal:

- **The six-rack monitor path**, after the buffer fix. Clean, no dropouts, with the racks
  switched on and off while playing.
- **The bridged mode** — both engines sounding at once — reported acceptable. What was
  *not* isolated is whether the desk was contributing to it: the bridge keeps the Rig side
  audible regardless, so this confirms the mode does not break anything and does not yet
  confirm that the desk itself made a sound.
- The **output picker's two test tones**, which is how the silent monitor was found at all.

Still unheard, and not to be reported otherwise: the desk on its own (see the open bug
below), its offline render, solo and mute across the two tiers, any strip meter, and
whether a rack's knobs audibly do what the DSP says — nobody has A/B'd one.

**One bug is open and unexplained.** Switching listening to the desk with the bridge off
produced silence on both sides: the Rig page went quiet as designed and the desk did not
come up. The desk's own TEST TONE separates the two cases — audible means its output is
fine and the fault is the signal into its channels, silent means its context is not
running — and that measurement has not been taken.

A later session added four more, all from one silent monitor that took a day:

- **A dead output stream is indistinguishable from a healthy one through the API.**
  `state: 'running'`, a clock that advances, `monitorBus=connected`, every gain at 1.0 —
  and an oscillator wired straight to `destination` producing nothing. Nothing in Web Audio
  reports it. The only way to see it is a second, fresh context making a sound at the same
  moment, which is what the two test tones are for.
- **The pedal publishes a playback endpoint too** (`Speakers (USB-Audio) (4c4a:c755)`), and
  Windows re-points its default at it when the device re-enumerates. That sends a whole
  debugging session after output routing. It was a red herring here, but it is a real
  hazard and the reason the output picker exists.
- **The pedal does hardware direct monitoring.** Headphones in the pedal hear the dry
  instrument whatever the app does, so "I hear the guitar but the racks change nothing" is
  its default state and says nothing about whether the app is working. Test with a tone, not
  with the instrument.
- **`<video>`/`<audio>` playback and Web Audio fail independently.** YouTube playing fine is
  not evidence that the page's audio works, and it was repeatedly mistaken for it.

The DSP underneath the jam page *is* verified numerically (FFT, beat tracking,
capture placement, the crossover response) — see the test status in the README.
Keep that distinction when reporting: the maths is checked, the audio path is not.

There is no test runner installed. Those checks were run by compiling the libs
with `npx tsc --outDir <tmp> --module commonjs` and running plain Node scripts
against them. Do the same rather than claiming something is untestable.
