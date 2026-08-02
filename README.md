# Guitar Recorder — web

Browser-based recording and video editing for an **M-VAVE Tank-G** multi-effects
pedal connected over **USB-C**. Takes are captured losslessly in the browser, then
laid over video and exported.

Next.js 16.2.12 (App Router) · React 19.2.4 · Tailwind **v4** · lucide-react 1.27 ·
`@breezystack/lamejs` 1.2 (MP3 export only, loaded on demand)

This is a **standalone project** with its own repository, released on its own
schedule. Its only connection to the server is an HTTP call to
`NEXT_PUBLIC_API_URL` — no shared code, no shared build, nothing imported across
the boundary. With that variable blank the app still runs; takes stay
session-local and cannot be persisted.

The server is a separate repository, **guitar-recorder-api**. Two things to know
before changing either side: the server **owns the wire contract** — the response
types in [src/lib/api.ts](src/lib/api.ts) are a mirror, and nothing will force you
to keep them in sync — and it only answers browser origins listed in its
`CORS_ORIGIN`.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev              # http://localhost:3001
```

Port 3001 is baked into the `dev` and `start` scripts. The API defaults to 3100,
which is also deliberate — `next dev` claims 3000/3001, so the server was moved
off 3000 to avoid losing the port race.

## Layout

```
src/
├─ app/               routes: / (recorder), /amp (tone: guitar/bass/drums/vocals/
│                     keys/brass), /mixer + api/tone (the only server route)
├─ components/
│  ├─ providers/      StudioProviders — recorder + mixer, above the router
│  ├─ recorder/       transport, meters, tuner, take list, amp rack + assistant
│  ├─ amp/            tone-page shell, instrument tabs, per-instrument racks,
│                     shared rack furniture
│  ├─ mixer/          console, channel strips, source row, transport, DSP graphs
│  ├─ board/          signal-flow board: renderer, wires, the amp's chain
│  └─ ui/             shell, panel, sidebar, controls, toast, theme
├─ hooks/             useRecorder, useMixer, useTakeLibrary, useInputDevices,
│                     useClientCapability, …
├─ lib/               audio, oklch, accent, inputSession, contextHealth,
│                     mixer, mixGraph, rig, ampFx, bassFx, drumFx, vocalFx, keysFx,
│                     brassFx, cabinet, ampGraph, ampStore, ampSchema, ampRender,
│                     tonePresets, toneIntent, rigLexicon, rigSchema, tuner, fft,
│                     pitchStabiliser, mp3, api
└─ types/             mixer, recorder, media
public/worklets/      recorder-processor.js, amp-dsp-processor.js (gate, limiter)
```

**There is no video editor, and no jam page.** `/editor` — a two-track NLE with
drag-and-drop, trimming, ripple delete, an IndexedDB draft and its own mixdown — was
removed on request, taking `useEditor`, `useAssetDrag`, `components/editor/`,
`lib/editorDraft.ts`, `lib/mixdown.ts` and `lib/tabCapture.ts` with it. `/jam` went
too, and with the video exporter gone there was nothing left that spoke the timeline
model, so `lib/timeline.ts` and `types/editor.ts` followed. Nothing in this app now
holds a clip, a project or a video: it is a recorder and a tone rack.

Sections below still describe the jam page and the video pipeline. They are kept
deliberately for now — the DSP reasoning in them (capture placement, the crossovers,
the clock-owns-the-playhead rule, what a YouTube source cannot do) was expensive to
arrive at and is the first thing anyone rebuilding either page would need. Treat them
as an archive, not as a description of the current routes.

**What replaces them is a mixer** (`/mixer`), in two halves that are now wired
together.

The **engine** — [types/mixer.ts](src/types/mixer.ts),
[lib/mixer.ts](src/lib/mixer.ts), [lib/mixGraph.ts](src/lib/mixGraph.ts),
[hooks/useMixer.ts](src/hooks/useMixer.ts) — is three tiers of gain: channel →
subgroup → master. A channel holds either a clip (a take from the shared library, or
an imported file) or the live input, one of the six instrument racks as its insert, a
fader, an equal-power pan, mute, solo, and a position in time. There is deliberately
**no clip model**: one source per channel, placed by a single offset and windowed by
an in/out pair, which is the jam page's layer geometry and the whole of it. The master
carries the only limiter, because it is the only bus that sees the whole sum. Output
is a deterministic offline render to WAV or MP3, built by the *same* `buildMixGraph`
as the live path — a second arrangement for the render is how the mix you heard and
the file you got start to differ.

The **console** — [app/mixer/](src/app/mixer/),
[components/mixer/](src/components/mixer/) — is an 8-strip desk with DSP crossover and
phase views. Every strip is one of the engine's channels: GAIN is the input trim before
the strip's rack, the fader is the level after it, and the LED meters are post-fader
analyser taps. [MixerTransport](src/components/mixer/MixerTransport.tsx) adds what a
console needs to be audible at all — its own input picker, play/stop with a playhead,
the master limiter switch and the render buttons — and
[MixerSourceRow](src/components/mixer/MixerSourceRow.tsx) is what puts something on a
strip in the first place.

Before that wiring the strips moved numbers only: gain and pan were local `useState`
arrays, the meters were `Math.sin()` per strip with `Math.random()` on the master, and
there was no transport, no device picker and no output. It looked alive and could not be
heard, which is a worse failure than a dead-looking page.

Nothing here has run in a browser. See the test status for what is checked and what is
not.

**The engines are mounted in the root layout, not in the pages.**
[StudioProviders](src/components/providers/StudioProviders.tsx) calls `useRecorder`
and `useJam` above `children`, so a route change no longer unmounts them. Before
that, leaving `/jam` closed the AudioContext, released the mic and revoked the
object URLs — the music stopped and the video was gone. Playback now ends only
when someone stops it, and the sidebar's
[NowPlaying](src/components/ui/NowPlaying.tsx) exists so the stop button is
reachable from a page that is not the one playing.

Two consequences worth knowing:

- The `<video>` element still belongs to the page, so it is destroyed and rebuilt
  across navigation. `resumePicture` in [videoSync.ts](src/lib/videoSync.ts) seeks
  the new element to the clock and plays it; without that the picture is a
  slideshow driven by drift correction.
- Browser capability flags (`canExportVideo`, `canCaptureTab`) go through
  [useClientCapability](src/hooks/useClientCapability.ts). Calling those probes
  during render is a hydration mismatch on a prerendered route: the server has no
  `MediaRecorder`, so it emits the disabled button and its "unsupported" tooltip
  while the client emits the enabled one. They read `false` for the first paint on
  purpose.
- The 60 fps playhead does **not** re-render the page. Each provider hands React
  the same `children` element every tick, so React bails out of that subtree and
  only context consumers re-render. Do not wrap `children` in anything there.

**It installs.** [manifest.ts](src/app/manifest.ts) is a metadata route rather than a
file in `public/`, so the manifest and the `<link>` cannot drift apart and a
misspelled `display` value is a type error instead of a silently non-installable app.
The icons are generated by a script over Node's `zlib` — PNG is four chunks and a CRC,
which is cheaper than adding an image dependency to a project whose DSP layer exists
to avoid them. [public/sw.js](public/sw.js) is deliberately **network-first with the
cache as a fallback only**: precaching a Next.js build is how you get a cached HTML
document pointing at hashed chunks the next deploy replaced, and the user's only way
out is clearing site data — which on this app also throws away their take library.

One thing no manifest can fix, and the most common reason a deployment is not
installable: **it must be served over HTTPS.** That is not only a PWA rule —
`getUserMedia` is refused on plain HTTP everywhere except `localhost`, so an HTTP
deployment has no microphone, no input and no takes.

## Architecture — do not undo these without reason

**Recording is lossless PCM, not `MediaRecorder`.** `MediaRecorder` only produces
lossy WebM/Opus. `public/worklets/recorder-processor.js` is an AudioWorklet that
batches raw Float32 frames (4096 at a time) to the main thread, which encodes real
16-bit PCM WAV in [src/lib/audio.ts](src/lib/audio.ts).

**The worklet routes through a muted sink.** Web Audio only pulls nodes with a
path to `destination`, so a zero-output worklet can go unprocessed. Its silent
output goes through a 0-gain `GainNode` → `destination`. Removing that silently
breaks capture.

**Browser voice DSP is disabled** — `echoCancellation`, `noiseSuppression` and
`autoGainControl` are all `false`. They mangle a guitar signal. They live in
`inputConstraints` in [src/lib/inputSession.ts](src/lib/inputSession.ts) so the
recorder and the jam page cannot drift apart on them.

**The input device is opened once, shared, and reopened by itself.**
[src/lib/inputSession.ts](src/lib/inputSession.ts) owns the hardware; both engines
hold a `clone()` of one stream and the device closes when the last holder releases
it. Two things made that necessary.

The recorder is armed from app start — it lives above the router so `/amp` can be
heard — so arming the jam page was a *second* `getUserMedia` on the same pedal. A
class-compliant USB interface does not reliably survive that: the second open can
reset the endpoint, which ends the first stream.

And a track that ends is a transient, not a verdict. `ended` is what the browser
says for USB selective suspend, a driver reset, another application taking the
device in exclusive mode, a sample-rate change, a hub power blip — nearly all of
which are over in a second or two. Both engines used to answer it by giving up:
`useRecorder` closed its whole `AudioContext`, so a 40 ms glitch took monitoring,
the meters, the tuner and the amp with it and left "Input device disconnected."
with nothing to press. The session reopens the same device instead — backoff from
200 ms to 4 s, cued by `devicechange` rather than by polling — and hands the fresh
stream back through `onStream`, where each engine re-points **one**
`MediaStreamAudioSourceNode`. Everything after that node is untouched, which is
what makes the recovery inaudible and keeps the tone dialled.

It re-finds the device by id, then hardware group, then label, and **never**
anything else: silently re-arming onto the laptop microphone would keep recording,
at a plausible level, from the wrong instrument. Running out of attempts is not
final either — a `devicechange` while `lost` starts a fresh round, so a pedal
plugged back in ten minutes later comes straight back.

**A take interrupted by a dropout is kept, not discarded.** The samples up to that
instant were captured against valid anchors, so they are encoded (recorder) or
placed as a layer (jam) and the reason is reported through a neutral notice. Only
a take cut short during the count-in is thrown away — that buffer is nothing but
clicks.

**The AudioContext has a watchdog too.**
[src/lib/contextHealth.ts](src/lib/contextHealth.ts) polls twice a second, because
the *other* way the sound stops is the context itself. A Windows endpoint reset
either suspends it — no event reaches page code, `currentTime` stops, and every
button still looks armed — or leaves it reading `'running'` with a clock that no
longer advances, which raises nothing at all. So: resume it when it suspends
(plus on the next gesture, for when the autoplay policy refuses), and watch the
clock for the case that has no event. The recorder answers a stall by arming
again, since it holds no buffers; the jam page rebuilds the graph around its
layers and captured backing, which are `AudioBuffer`s and belong to no context.
A second stall inside 15 s stops the automatic rebuild and says so — twice in a
row is not a transient, and rebuilding on a loop would be worse than silence.

**Meters and timecode bypass React.** One rAF loop in `useRecorder` writes to
refs; `LevelMeter`, `LiveWaveform` and `TimeCode` read those refs and paint
directly. React state changes only on whole-second and transport-state
boundaries. Turning this into state would re-render the dashboard 60×/second.

**The playhead is driven by the AudioContext clock, and the video element is slaved
to it** ([src/hooks/useJam.ts](src/hooks/useJam.ts)). The reverse — video as clock —
is the usual mistake: `video.currentTime` updates only a few times a second and
drifts, so audio scheduled against it audibly wanders. This was the editor's rule
first; it is the jam page's rule for exactly the same reason, and the YouTube player
is on the same leash (with a much looser tolerance — see below).

**Two lessons the editor took with it, worth keeping in view because the jam page
now carries them:**

- *A video's own audio is part of the mix.* The editor's `scheduleAudio` used to skip
  every clip on a video track, so an imported video played as a silent picture and
  exported as one, with nothing reporting it. `useJam`'s backing path and `renderMix`
  are the same shape of problem: the song is a decoded buffer in the graph, not an
  element playing itself, precisely so it cannot fall out of the export.
- *Undecodable audio is a normal import, not a fatal one.* A video with no audio
  track must still load and still export its picture. Both `decodeAsset` callers
  name what they skipped rather than failing the whole operation, because silence
  with no explanation is the bug that keeps coming back.

## Jam page (`/jam`)

Import a video, play along, and overdub guitar onto it.

**Backing playback and guitar capture share one `AudioContext`.** The page exists
to answer one question correctly — *where in the song was this note played?* — and
two contexts have two clocks that drift apart, with no way to recover the
relationship afterwards.

**The video's audio is decoded into the graph, not played by the element.** Only
then can it be levelled, muted, tone-shaped and exported. An element playing its
own track sits outside Web Audio and would also glitch every time the sync loop
corrects its position.

**Takes are captured dry, before the effects rack.** The rack is applied to
monitoring, to layer playback and to the mixdown, so what you hear while
overdubbing is what you get — but it is never printed. A guitar arriving from a
multi-FX pedal is already committed to its sound once; committing it twice is
irreversible.

**Latency compensation is the most important number on the page**
([src/lib/overdub.ts](src/lib/overdub.ts)). Everything played arrives late by the
round trip through the interface, so each take is shifted *earlier* by that
amount. The browser's reported figure underestimates on most systems, hence the
manual trim. Get this wrong and every take sits behind the beat no matter how well
it was played.

**A negative offset trims the capture rather than clamping it.** Clamping to zero
would keep the count-in audio and drag the first note late by the whole count.

**Beat tracking is classical DSP, no ML** ([src/lib/beats.ts](src/lib/beats.ts)):
spectral flux onsets → adaptive whitening → autocorrelation under a log-normal
tempo prior → least-squares refit against the observed onsets. The prior prevents
octave errors; the refit is load-bearing, because a 0.3 BPM error walks the grid
tens of milliseconds off the music across a long track.

**Snapping moves the take's first note, not its first sample.** Aligning the
buffer start does nothing for a player who left two bars before coming in.

**Layers carry NLE clip geometry** — `offsetSec` positions, `inPoint` /
`outPoint` window the capture — so trimming is non-destructive and a split costs
no memory, both halves sharing one buffer. Trimming the head moves `offsetSec`
with `inPoint`, which is what keeps the remaining notes standing still; moving
only the in-point would slide the whole performance early.

**Dragging snaps only from a few pixels away.** A snap that reached across half a
beat would override the drag rather than assist it, and there would be no way to
place a deliberately offbeat layer.

**Two racks, deliberately separate.** [ampFx](src/lib/ampFx.ts) shapes one raw
instrument; [songFx](src/lib/songFx.ts) does narrow corrective work on finished,
balanced material. Running both through one chain would mean every move for one
fought the other.

**One guitar chain, and it is the full amp.** Both pages run
[createAmpChain](src/lib/ampFx.ts) — cabinet convolution, cascaded valve stages,
look-ahead limiter — the recorder on its monitor path, the jam page on monitoring,
layer playback and the mixdown, which `renderMix` rebuilds offline so the export
contains what was heard. Dial a tone on one page and the other gives you that tone.

The jam page used to have a second, smaller rack: drive, EQ, comp, delay, reverb,
written for a guitar arriving from a multi-FX pedal with its cabinet **already
printed**. Deleted, along with its board and its graph. Feed that chain a dry DI and
there is no speaker anywhere in the path: a raw pickup through a waveshaper is fizz,
and a shelf at 3.2 kHz is not an impulse response. A sweetener is now `cab` and
`drive` switched off in the one rack — not a second chain for the same signal, which
is how you end up processing a guitar twice and being unable to say where.

Three properties of that swap matter. The amp in `useJam` is **nullable**: its gate
and limiter are AudioWorklet processors, and a browser that refuses the module still
has to play the backing rather than take the page down. The mixdown, by contrast,
**throws** rather than rendering dry — a file that is quietly a DI recording of a
sound nobody heard looks like a success. And takes are still captured before all of
it, so the tone stays editable after the performance.

**One input, three racks, all three live — this is a mixer as well as an effects
rack.** The tone page carries a guitar amp, a bass rig and a drum bus, and all three
chains run in parallel and permanently on the monitor path. An earlier design rebuilt
the chain when the tab changed, to save the CPU of three convolvers; that was wrong
about what people do, which is dial a bass sound, dial a guitar sound, dial the drums,
and then play with all of it running. Switching a tab now changes what you are
**looking at** and nothing you can hear.

What balances them is the [RigMixer](src/components/amp/RigMixer.tsx): per-channel
power and a fader, so "off" is a gain of zero rather than a teardown and a channel
returns instantly and without a click. The faders reach 150% because a drum bus and a
guitar amp do not arrive at the same level, and fixing that with the output trim
inside a rack would change what that rack's own limiter sees. Two channels start off —
three chains is three convolvers, six worklet processors and three oversampled
waveshapers, and nobody should pay for a rack they have not opened. The dry input is
audible only while all three are off, so bypassing everything is not silence.

The interface follows the same split: each rack is its own file
(`components/amp/BassRack.tsx`, `DrumRack.tsx`, and the guitar's existing `AmpRack`),
composed by a shell that owns only what spans them. One interface — `RigChain` in
[rig.ts](src/lib/rig.ts) — means the engine never branches on which instrument is
plugged in.

**A bass rig is not a guitar amp with different numbers.** The signal splits at a
Linkwitz-Riley crossover and **only the band above it is driven**: distorting a 41 Hz
fundamental replaces it with harmonics rather than adding to them, so the note gets
smaller -- fine on headphones, gone on a phone speaker. There is a DI blend tapped
before the drive and the cabinet, the EQ is a four-band graphic *after* the drive
rather than a tone stack before it, and the cabinet is mono because a bass is the one
thing in a mix that has to survive a fold-down. Two bass cabinets were added to
[cabinet.ts](src/lib/cabinet.ts) for it: measured, the 4x10 is 2.0 dB down at 45 Hz
where the guitar V30 is 12.8 dB down, which is the whole argument against reusing one.

**A drum bus gets its punch from a parallel path, not from a compressor in series.**
Squashing a kit to make it louder makes it quieter -- the transients are what "loud"
means on a drum, and a compressor removes exactly those. So `Punch` is the level of a
crushed *copy* added underneath a dry path that stays at unity: it can only add. The
EQ sits before the compressors, because a compressor reacts to what it is fed and
cutting the 400 Hz box afterwards leaves the crushed copy still triggered by it.

**Tone lives on its own route, and every page shares one rig.** `/` is transport,
tuner and takes; [/amp](src/app/amp/page.tsx) is the rack, the cabinet, the mastering
section and the assistant. They are not two copies of anything:
[ampStore](src/lib/ampStore.ts) is a module-level external store that `useRecorder`
and `useJam` both subscribe to, so a knob moved on the tone page is heard on the
input you are playing *now* and printed into a jam mixdown *later*, with no apply
step. `useRecorder` had to move above the router for this — navigating away from the
page that owned it closed the AudioContext, which would have left the tone controls
dialling an amp nobody could hear.

**The assistant reads all three instruments.** The machinery in
[toneIntent](src/lib/toneIntent.ts) — filler stripping, fuzzy genre matching, clause
splitting, direction, magnitude, residue — has no instrument in it; what differs is
which controls a word moves, and that lives in a `Lexicon`.
[rigLexicon](src/lib/rigLexicon.ts) has the other two. "หนาขึ้น" is one request and
three different edits: the guitar's bass shelf, the bass rig's sub shelf **and** its
clean low band (that rig has a separate level for the undistorted bottom, so moving
the EQ alone would do half the job), the drum bus's kick shelf. Three rules exist that
have no guitar equivalent at all, and they encode a rig's own logic rather than a tone
adjective: bass drive raises the crossover with it, bass "definition" reaches for the
DI rather than for treble, and drum "punch" is the parallel blend — nothing reaches for
the glue compressor to make a kit hit harder, because that is the move that makes it
hit softer.

**The tone assistant reads every request locally first, and only escalates what it
could not explain.** [toneIntent](src/lib/toneIntent.ts) is a lexicon of the words
guitarists actually use — Thai and English — each mapped to the controls that change
that thing, with a direction and a magnitude. It runs offline, costs nothing and
answers in the same millisecond. It also strips filler ("เอาแนว…หน่อยครับ") and
matches Thai genre names within an edit distance of one or two, because real requests
are misspelled: "หมลำ" is one dropped vowel from "หมอลำ" and used to be met with "ยัง
ไม่เข้าใจ".

What decides escalation is `residue` — the text left over once every genre name, rule
word, direction, magnitude and filler has been accounted for. Nothing left means the
lexicon read the whole request and a model would only agree more slowly; a sentence
about a song or an artist is almost entirely residue, and that is the only thing
[/api/tone](src/app/api/tone/route.ts) is asked. In the other direction the fallback is
still silent: no `ANTHROPIC_API_KEY`, rate limited, offline, refused or unparseable all
resolve to the local reading. Each reply in the transcript is badged with which engine
answered. Twelve genre voicings
([tonePresets](src/lib/tonePresets.ts)) sit in front of both as one-tap starting
points, several of them Isan: morlam, phin kong yao, lai phin.

**Nothing reaches the audio graph unclamped.**
[clampAmp](src/lib/ampSchema.ts) is total — it never throws and never returns a
partial object — and it sits between every untrusted source and `createAmpChain`: the
model's reply, the request body, a stale `localStorage` preset. A model that answers
`drive.amount: 4` is not a bug report, and the ranges are enforced in one place
rather than trusted at fifteen call sites. Every reply also carries its diff and its
own undo, because a tone control driven by a sentence is only usable if you can see
what it did and put it back in one tap.

**The bass tightener is a real crossover, not a shelf.** A flabby low end is one
whose *level* wanders, which no EQ setting fixes — it needs compression on the
lows alone. The split is Linkwitz-Riley 4th order (two cascaded Butterworth
sections per band) because a single lowpass plus a single highpass at the same
corner sums to a **complete null** at the crossover frequency.

## Where a song can come from

Three kinds of source, and the differences are not policy — they are what the
browser permits. The jam page refuses a source by name rather than failing later.

| | Local file | Direct link (`.mp4`…) | YouTube link | YouTube, after capture |
|---|---|---|---|---|
| Plays, with sound | ✅ | ✅ | ✅ (its own iframe) | ✅ |
| Level / mute | ✅ | ✅ | ✅ (player volume, 0–100%) | ✅ (our gain, 0–200%) |
| Tempo detect, song EQ | ✅ | ✅ | ❌ | ✅ |
| Overdub | ✅ sample-accurate | ✅ sample-accurate | ⚠️ approximate | ⚠️ approximate |
| WAV / MP3 mixdown | ✅ | ✅ | overdubs only | ✅ with the song |
| Video export | ✅ | ✅ | ❌ | ❌ |

Capturing the tab gets the song's **samples**, which is what tempo detection, the
song EQ and the mixdown need. It does not get the *frames*: the picture is still
YouTube's iframe, which cannot be drawn to a canvas, so video export stays refused
by name for a YouTube source however much audio has been captured. The editor page
used to offer a way around that — record the tab as a video *file* and treat it as
an import — and that route went with the page.

A direct link is fetched into a `File` ([remoteMedia.ts](src/lib/remoteMedia.ts))
and then follows the local-file path exactly, so everything works — provided the
server sends CORS headers. It usually does not, and that failure is reported as
itself rather than as a mysterious decode error.

A YouTube clip is different in kind. It plays inside YouTube's iframe, and that
frame's audio cannot be read by Web Audio and its frames cannot be drawn to a
canvas. So there is nothing to analyse, nothing to EQ and nothing to encode —
`JamSource.kind` exists so every feature that needs samples can refuse honestly.
Getting the media itself would mean downloading it outside the player, which is
against YouTube's terms; this app does not do that and has no server that could.

### What went with the editor

Recording a tab **as a video file** — `lib/tabCapture.ts`, `MediaRecorder` around
`getDisplayMedia`, capped at 15 minutes — existed so a YouTube clip could become an
import the editor could cut. There is nothing left to cut with, so the file is gone
too. The jam page's own tab capture is a different thing and remains: it takes the
*audio* through the recorder worklet, which is the subsection below.

The editor's "paste a link and it plays as a preview" behaviour went with it. On the
jam page a pasted watch URL is a real source (`JamSource.kind === 'youtube'`) that
plays, takes overdubs and refuses by name what it cannot do — there is no preview
state to be in.

### Getting a YouTube clip into the mix

There is exactly one route, and it is a realtime one: **capture the tab**. The user
hands the app their tab's audio through `getDisplayMedia` — an explicit,
browser-mediated permission, the same gesture as sharing a screen — and it is
recorded through the same worklet a guitar take uses. Nothing is downloaded and the
clip still plays from YouTube; this is a line-out recording of the user's own tab.
Whether a given clip may be recorded at all is the user's call, not the app's.

Once those samples exist the clip stops being a special case: song EQ, tempo
detection and the WAV/MP3 mixdown all operate on `backing` and no longer care where
it came from. Video export still cannot, and never will — it needs the *frames*.

Three consequences are load-bearing:

- **The buffer does not start at song zero.** Capture begins wherever the playhead
  was, so `backingOffsetSec` records the song time of its first sample and
  `backingPlacement` ([overdub.ts](src/lib/overdub.ts)) turns that into a start
  time and an offset. Scheduling it with the naive `start(when, from)` plays the
  captured stretch from the wrong point — silently, and only for this source.
- **The player is muted for good afterwards**, and our copy is what you hear.
  Otherwise the song plays twice, once through the song EQ and once not.
- **Alignment is by ear.** Tab capture has a pipeline latency no browser reports,
  so the captured song can sit tens of milliseconds off the overdubs recorded
  against it. That is what the "Song align" trim is for.

Capture is capped at 8 minutes: Float32 stereo at 48 k is ~23 MB a minute in
memory, and the page is for songs, not for archiving a three-hour stream.

The player is **slaved to the AudioContext clock** like every other picture here,
with a 750 ms drift tolerance instead of 80 ms because a YouTube seek re-buffers
audibly. That tolerance is exactly why overdub placement is approximate: the
clip's own start latency is unknown and unmeasurable. Recording is still allowed —
practising against a song is the point — and the latency trim and per-layer nudge
are there to fix it by ear.

## Video export

[src/lib/videoExport.ts](src/lib/videoExport.ts) uses **`MediaRecorder` +
`canvas.captureStream()`**, not a WebCodecs remux. A remux needs an MP4 demuxer
and could not be verified without a real browser; this path works everywhere with
no extra dependencies.

Its one caller is the jam page (`exportVideo` in `useJam`), which builds a one-clip
`EditorProject` for it — that model, and the two functions of `lib/timeline.ts` this
file calls, are the reason both outlived the editor page.

1. Render the audio offline (`useJam`'s own `renderMix`, the same lossless render the
   WAV export uses, amp and all).
2. Draw the active video clip into a canvas frame by frame, driven by the
   AudioContext clock — the same reference as preview playback.
3. Feed the canvas video track plus the offline mix through a
   `MediaStreamAudioDestinationNode` into `MediaRecorder`.

**Only the video is re-encoded.** The audio is the offline render piped straight
in, never captured off the speakers.

Accepted trade-offs, both inherent to the approach: the video loses some quality,
and encoding runs at **realtime speed with the tab visible**, because frame pacing
rides on `requestAnimationFrame`. The Cancel button exists for exactly that
reason.

Container is MP4 (`avc1`/`mp4a`) where supported, else WebM (VP9/Opus). Output is
capped at 1920 on the long edge and forced to even dimensions — H.264 and VP9
reject odd ones.

Upgrade path if quality matters later: a WebCodecs remux keeping the source video
track untouched and only encoding new AAC audio, via `mp4box.js` + `mp4-muxer`.
Chrome/Edge/Safari 17+ only, so keep this path as the fallback rather than
replacing it.

## Design rules

An earlier pass built translucent glass panels over animated aurora glows. It
looked good in isolation and was **unusable** — colour washed across the video
monitor and the text. It was removed entirely.

- Opaque panels, one visible 1px border, **nothing decorative behind content**.
- **Motion must mean something.** The looping animations all signal recording:
  `rec-pulse`, `rec-ring`, `led-blink`, `tape`. The rest are one-shot and carry
  information too — `rise-in` / `pop-in` / `toast-in` mark arrival, `toast-timer`
  drains to show how long a toast has left.
- **Failures sit still; successes expire.** An error stays pinned next to the
  control that caused it, because it needs acting on. A confirmation — currently
  only "video imported" (`ui/Toast.tsx`) — is a toast: it has to be *seen*, not
  dealt with, and keeping it out of the message row means it cannot reflow the
  monitor at the moment the picture appears. Hover or focus holds it open, since
  the filename is the part worth reading slowly.
- **Red is reserved for "live" or "broken"** — never decorative. A past bug passed
  `live={isPlaying}` to the video monitor and turned the whole picture red during
  playback; playing is not recording.
- **The palette is measured, not picked.** Nine hues — red, orange, amber, green,
  teal, cyan, blue, violet, pink — and each one is the *most saturated* value sRGB
  can show at a lightness that still clears WCAG AA on the surface it is used
  against (white in the light theme, `--c-raised` in the dark one). 96% of the
  gamut edge, not 100%, so eight-bit rounding cannot push a colour out and shift
  its hue. `lib/oklch.ts` does the measuring and the numbers are asserted, so a
  hand-edited token is caught rather than shipped. Do not brighten or dull one
  without re-running the check.
  - The light theme has almost no room: cyan and teal were already within 2% of
    everything sRGB can do at a readable lightness, which is why they look
    restrained there and vivid on black. Violet and pink are where the old palette
    was leaving saturation on the table (+24% and +32% chroma).
  - Dark violet moved *down* 8% in chroma. At its old lightness it measured 3.9:1
    on `--c-raised` — it was failing AA wherever a violet chip sat on a raised
    panel. An unreadable accent is not a vivid one.
- **The free accent hue is five numbers, and both of the per-hue ones matter.**
  `lib/accent.ts` writes the hue plus a measured lightness *and* chroma for each
  theme; `globals.css` assembles the colour. It used to write the hue alone and
  pair it with one constant chroma per theme — which is outside sRGB for 30 of 72
  hues in the light theme and **45 of 72** in the dark one, so most of the wheel
  was being mapped back onto the gamut wall. That is what made the picker pastel
  and neighbouring degrees indistinguishable. There is no constant that works: at
  one lightness the most saturated violet is three times as chromatic as the most
  saturated blue. Per hue, the range is 0.09–0.30 chroma in the light theme and
  0.14–0.31 in the dark, worst-case contrast 4.60:1.
- The jam page is a **fixed-viewport layout, not a scrolling page** (`lg:h-dvh` +
  `overflow-hidden`). This was the editor's rule first, and it is the same problem
  here: a scrolling page pushes the monitor off screen when you reach the lanes, and
  the picture and the layer you are placing against it must stay visible together.

## Test status

Verified by automated test:

- WAV encoder — 30/30 checks (RIFF header fields, 16-bit round-trip, L/R
  interleaving, clip clamping at ±32767/−32768, peak dBFS, meter scale). Output
  also opens in the Windows media stack with the exact duration.
- ~~Timeline maths (`lib/timeline.ts`) — 40/40~~ and ~~ripple delete / close gaps —
  14/14~~. **The file is deleted**: the editor page went, then the video exporter that
  was still calling two of its functions went with the jam page. Recorded here rather
  than dropped, because "trim anchoring, split continuity, mute/solo resolution,
  snapping" were checked once and would have to be checked again from scratch.
- FFT (`lib/fft.ts`) — 6/6 against a naive DFT (max error 1e-6), tone-bin
  placement, spectral leakage < 1%.
- Beat tracking (`lib/beats.ts`) — 24/24. Across 62–180 BPM: tempo exact to
  **±0.003 BPM**, downbeat phase within **3.5 ms**, and unpulsed noise correctly
  reported as low confidence. ~300 ms for 60 s of audio.
- Capture placement (`lib/overdub.ts`) — 16/16: latency always shifts earlier,
  count-in trims rather than clamps, snapping lands the first note exactly on a
  beat and refuses to push a take before zero.
- Song crossover (`lib/songFx.ts`) — the LR4 split sums flat to **0.000 dB** at
  every frequency; the single-order alternative nulls completely at the corner.
- Contrast — every text pair ≥ **4.79:1** (WCAG AA) in both themes. The nine
  colour tokens are held to 4.6:1 against the surface they sit on, which is the
  bound the saturation search runs against.
- Palette and accent (`lib/oklch.ts`, `lib/accent.ts`, `app/globals.css`) —
  **21/21**, and eleven of them read the real stylesheet rather than a copy of it.
  The maths first: `#rrggbb → oklch → #rrggbb` is an exact identity, sRGB red
  lands on Ottosson's own `oklch(0.6279 0.2577 29.23)` to 0.001, `maxChromaFor`
  sits on the gamut boundary at every hue tested (inside at `c`, outside at
  `c + 0.002`), and the gamut is confirmed star-shaped about the achromatic axis —
  the property that makes the binary search valid at all. Then the tokens as
  shipped: every one of the eighteen clears AA on its own surface, every one is
  ≥ 90% of the chroma available at its lightness, the two themes of each token
  agree on hue to within 4°, no two hues are closer than 15°, and each rail marker
  sits on its token to within 1.5°. The copies are checked against their sources —
  meters, live wires and drop hints must *be* teal/cyan/red/violet rather than
  near-misses, and the `rgb()` triples in the glow shadows must match the hexes
  they were taken from. `accentTone` is verified in gamut and ≥ 4.5:1 at all 360
  hues in both themes, and asserted to be the true maximum: no lightness in range
  offers more chroma at that hue. Finally the stylesheet's own numbers — both
  accent fallbacks equal the default hue's measured tone, and all 26 rail stops
  equal what the picker would produce at their hue, so the rail cannot drift into
  advertising colours it does not deliver.
- ~~Mix scheduling (`scheduleAudio`) — 12/12~~ — deleted with `lib/timeline.ts`. It
  covered a video clip's audio reaching the mix, per-track and clip-level mute, solo
  spanning both track kinds, dangling references and a video-only project rendering.
- Backing placement (`backingPlacement` in `lib/overdub.ts`) — 21/21: the decoded-
  file identity case, a capture that starts partway into a clip played from before,
  inside, exactly at and past its end, a negative start trimming the head rather
  than shifting the song, degenerate durations, and the invariant that
  `from + delay − offset` always equals the buffer's song-time start.
- MP3 encoder (`lib/mp3.ts`) — 20/20 by parsing the output's own frame headers:
  MPEG-1 Layer III sync, sample rate (44.1 / 48 k), all four offered bit rates
  reported correctly, mono vs stereo channel mode, encoded size within range for
  the bit rate, plus clipped input, >2 channels and a sub-block buffer.
- Knob geometry (`lib/gauge.ts`) — 39/39. The octagon is a real octagon: every
  one of 1081 points sampled along the 270° sweep lies on a straight edge to
  **1.4e-14** units, where a circle of the same radius departs from that edge by
  up to 7.6% of the radius. Vertices land on the circumradius and edge midpoints
  on the apothem exactly; the gauge's two ends are mirror images about the
  vertical, which is why the first vertex sits at 22.5°.
- Bass and drum clamps, diffs and lexicons (`lib/rigSchema.ts`, `lib/rigLexicon.ts`)
  — 156/156. The clamps are total against every way a value can be wrong, and the one
  that matters most is asserted directly: a **guitar** cabinet id offered to the bass
  rig is refused rather than accepted. Every rule in both lexicons is checked to move
  something and to stay in range while doing it, and the per-instrument meanings are
  asserted rather than assumed — "หนาขึ้น" moves the bass rig's sub *and* its clean low
  band but only the drum bus's kick; bass drive raises the crossover with it;
  "definition" raises the DI; "ตึบ" raises punch and leaves the glue untouched. Six
  preset names resolve per instrument, including a misspelled one.

  One real bug came out of this suite: `สด` — "live", a drum preset's keyword — is an
  exact substring of `สวัสดี`, so a greeting selected a whole drum voicing. Thai
  keywords now need three characters, which is the same judgement that keeps latin
  keywords word-anchored.
- Bass rig and drum bus (`lib/bassFx.ts`, `lib/drumFx.ts`, `lib/rig.ts`,
  `lib/cabinet.ts`) -- 218/218. Every preset and default is in range on every field,
  each uses a cabinet of its own instrument's kind, and no two presets in an instrument
  are the same sound under different names. The relationships the presets are supposed
  to express are asserted rather than assumed: grind splits higher than fingerstyle,
  slap cuts the low mids hardest and blends the most DI, tight is the one that gates,
  punch blends more of the crushed copy than natural. Two invariants matter most --
  every bass crossover sits **above the open E at 41 Hz** (below it there is no clean
  band to protect, which is the rig's whole premise), and every drum preset hits the
  parallel copy harder than the glue compressor (otherwise it is not a parallel path,
  it is a second bus compressor). All six cabinets are confirmed level-matched at 1 kHz
  to within 0.5 dB, and the bass/guitar split is measured at 45 Hz: -2.0 dB against
  -12.8 dB.
- Tone assistant — **342 checks over two suites**. Escalation and fuzzy matching
  (98/98): "เอาแนวหมลำ" reaches morlam with an empty residue, ten misspellings land on
  the right mode, six filler phrasings of the same request all resolve locally, every
  preset is reachable by its Thai label wrapped in filler, and eleven ordinary
  requests are confirmed to spend **no** model call while four song-and-artist
  requests are confirmed to escalate. The false-positive set is the other half of it:
  "popular request", "lock the tuning", "a band sound" and "law of physics" must match
  no genre, which is why latin keywords are word-anchored and Thai ones need four
  characters. Timed, too — the fuzzy pass is bounded at 16ms on a 426-character
  prompt, after a first version measured 177ms.
- Amp schema, presets and intent (`lib/ampSchema.ts`, `lib/tonePresets.ts`,
  `lib/toneIntent.ts`) — 244/244. `clampAmp` against every way a value can be wrong: out of range both ways,
  `NaN`, `Infinity`, numeric strings, a bogus cabinet id, `drive.stages` of 9, a bare
  `{}`, `null`, an array, and a whole-object string. Partial input keeps the base
  rather than resetting to defaults. All twelve genre presets are already in range
  (a preset outside them would be silently rewritten when applied, so the picker
  would lie) and no two are the same sound under different names. The intent engine
  is checked in both languages for direction, magnitude, clause splitting, and the
  two collisions that actually bit: **Thai direction particles** — "บางลง" is
  thinner and "เบาลง" is quieter, so `ลง` after an adjective intensifies where it
  reverses after a control name, and reading it the same way both times silently
  inverted five requests — and **genre names containing tone words**, where
  "พิณกองยาว" contains ยาว and applied the sustain rule on top of the preset.
- Amp signal-flow board (`lib/ampGraph.ts`) — 129/129. Every edge names a real
  node, every node is reached, no two boxes overlap (an overlap hides a wire), and
  the two orderings the board exists to teach hold: the tone stack sits above the
  drive and the output trim above the limiter. Also the three-state semantics — a
  flat tone stack is **in path but inert**, a bypassed cabinet stays in the path
  because its bypass is a parallel gain, and a zero-mix send leaves it — plus every
  shipped preset laying out without a NaN.
- Saved amp presets (`lib/ampPresets.ts`) — 25/25, mostly about surviving bad
  storage: non-JSON, JSON that is not an array, nulls, strings, entries with no
  settings and settings missing a sub-object are each **dropped rather than
  thrown**, a valid entry beside a broken one survives, and `localStorage`
  throwing on both read and write leaves the presets working for the session.
  Saving over an existing name replaces it, and the stored copy is deep, so
  editing the live settings afterwards cannot reach back into it.
- Limiter sliding maximum (`worklets/amp-dsp-processor.js`) — 13/13 against the
  full rescan it replaces: **identical at every sample** on noise, monotonic rise
  and fall, constant input, isolated transients, decaying plucks and seven window
  sizes. 2.5× faster (1.00% → 0.39% of the audio thread), and the per-sample array
  allocation — 48,000 a second on the render thread — is gone. The first version
  sized the deque at `window + 1` and reported the *newest* sample as the window
  maximum on a falling signal; only the comparison caught it.
- Tuner detection (`lib/tuner.ts`) — 105/105. Pure tones from **B0 (30.87 Hz) to
  E5** land within **±0.02 cents**; a detuned string reads its offset to ±0.01
  cents from −30 to +30. Notes whose fundamental is 12 dB down on the 2nd
  harmonic, or **absent entirely**, still report the fundamental rather than the
  octave. Silence, white noise and a window too short for the note all return
  nothing. Sample-rate independent: the same accuracy at 8 k, 16 k, 22.05 k,
  44.1 k and 48 kHz, which is what makes a Bluetooth voice-profile input usable.
  Cost is 2.0–8.5 ms per reading depending on window, run at an interval that
  keeps it under a tenth of the main thread.
- Tuner adaptive gate — mains hum is *periodic*, and a fixed level gate reports
  50 Hz as a confident G1 (clarity 1.000). The running-minimum floor rejects it
  **60/60 blocks** while still finding a bass E played over the same hum.
- Tuner band limiting — a low E under a 24 Hz rumble four times louder is
  undetectable raw and reads **0.77 cents** after filtering; a clean tone is
  shifted by 0.005 cents, provided the filters are settled on audio *before* the
  window (0.95 cents of error if they are not).
- Pitch stabiliser (`lib/pitchStabiliser.ts`) — 29/29 with the above. A 25-cent
  attack glide never reaches the display; ±4 cents of measurement jitter
  (2.31 ¢ RMS) shows as **0.94 ¢ RMS**; a 40-cent peg turn is followed in **60 ms**;
  a single octave-slipped reading moves the needle 0.00 cents.
- Intonation and sweetening — an out-of-tune string still reads as well intonated
  (the check is open-vs-12th, not against the target), and a sweetened target
  moves the needle rather than the measurement.
- Mixer logic (`lib/mixer.ts`) — **42/42**, and they are about the two things a mixer
  gets silently wrong. *What is audible:* every one of the four solo/mute rules is
  asserted on its own — a channel solo beats that channel's mute, a channel solo beats
  a **group** mute, a group mute silences its unmuted channels, and a channel mute
  still applies inside a soloed group — plus the invariant that closes the gap between
  the two tiers, checked over all **64** combinations of six flags: the group tier can
  never silence a channel the channel tier passed. *Where a channel starts:* the three
  placement cases (playhead before, inside, past) and the lock between buffer time and
  mix time — `from + delay − offset` is constant for a channel at every playhead
  position, to 1e-9, which is what stops a channel the playhead landed inside from
  playing the wrong audio. Also: the fader is silent at the bottom of its travel rather
  than −60 dB (twenty channels at the bottom otherwise make a floor nobody can find),
  monotonic across it, and clamped above +12; the pan law holds `L² + R² = 1` at every
  position, where the linear alternative measures 0.5; a head trim moves `offsetSec`
  with `inPoint` so nothing already placed moves, and a tail trim moves nothing; and
  `needsRebuild` says no to nine kinds of parameter change and yes to the three that
  need new nodes. The strip's two level controls are checked apart: the fader's
  position→dB law puts unity at 75% of travel and round-trips both ways to 1e-9 (the
  strip draws from dB and writes back position on every frame of a drag, so a lossy
  mapping would make faders crawl), while a straight linear map is confirmed to put
  unity at 83.3% — and the **trim** is quiet at its floor rather than silent, because a
  trim that muted would be a second mute.
- Device recovery (`lib/inputSession.ts`, `lib/contextHealth.ts`) — **26/26**. Four of
  them are about the `default` alias, which is a pointer rather than a device: it resolves
  to the hardware behind it through the shared `groupId`, never to the `communications`
  alias and never to an output that happens to share the group, and an alias it cannot
  resolve stays its own key instead of guessing. That resolution is what stops one pedal
  from being opened twice under two names. The
  backoff is bounded and never goes backwards, and the whole loop is between one
  and two minutes of trying — long enough for a replug, short enough that "lost"
  still means something. Device re-matching is asserted in both directions: the
  same pedal is found again by id, by hardware group after a re-salt, and by
  label after both change, while an **absent** device returns nothing rather than
  the laptop microphone, and neither the `communications` alias nor an output
  endpoint sharing the pedal's group can be selected as an input. The stall
  detector reports a frozen clock only after the full window, treats sub-quantum
  drift as frozen, and — the case that would make it a nuisance — does **not**
  report a stall when the poll itself was delayed on a context that kept
  rendering.
- YouTube link parsing (`lib/youtube.ts`) — 25/25: watch, `youtu.be`, embed,
  shorts, live, `/v/`, `-nocookie`, `m.`/`music.` hosts, missing scheme, extra
  query params, bare id — and rejection of look-alike hosts such as
  `myyoutube.com.evil.example`.

MP3 is lossy and WAV remains the lossless path; both are offered rather than one
replacing the other. The encoder is a ~160 kB LAME port, `import()`ed on first use
— verified absent from the eagerly loaded page chunks.

**Never run in a real browser:**

- Live capture with the Tank-G plugged in (needs the hardware and a mic grant).
- Video export end to end.
- Bluetooth input detection.
- The entire jam page: overdub capture, latency compensation, monitoring, both
  effect racks, and its exports. The DSP under it is tested; nothing above it is.
- The import toast, including whether its `<video>` poster frame actually paints
  a frame after the seek in `onLoadedMetadata`. It type-checks and builds; it has
  never been seen on screen.
- Playback surviving a route change, and the picture re-arming when you come back.
- The YouTube player: the IFrame API loading at all, `playVideo`/`seekTo` obeying
  the clock, how bad the drift really is, and whether recording against it is
  usable in practice. The link parser is tested; the player is not.
- Fetching a pasted link (needs a CORS-permitting host to try against).
- Tab capture end to end: the picker appearing, "share tab audio" actually
  delivering samples, and how far off the captured song lands. The placement maths
  is tested; no capture has ever run.
- MP3 export **in a browser**. The encoder's output is verified byte-wise under
  Node; nobody has clicked the button or played the resulting file.
- **The entire mixer.** No `AudioContext` has built `buildMixGraph`, no channel has
  been scheduled, no offline render has run, and no strip meter has been seen to move.
  The console is wired to the engine and both compile; whether a fader moves the sound,
  whether a take loads onto a strip, and whether a render comes out matching what was
  monitored are all unverified. The pure logic is checked; every line that needs a node
  is reasoned.
- **The whole recovery path.** Not one dropout has been recovered from in a
  browser: no device has been unplugged and replugged, no track has fired `ended`,
  `mute` or `unmute`, no context has been observed suspending or stalling, and no
  take has been salvaged. Whether two `AudioContext`s can each read a clone of one
  device stream — the premise of sharing the pedal between the recorder and the jam
  page — is also unverified. The arithmetic and the device matching are checked;
  everything that has to happen in a browser for any of it to work is reasoned.
- The tuner **against a real string**. Every number above comes from synthesised
  signals. A real pickup has inharmonicity, a real room has resonances, and a real
  plucked note decays; none of that is in the test signals. The maths is checked,
  the instrument is not.

Do not claim any of those work.

## Known limits

**Tempo detection reports half-time above ~180 BPM.** The log-normal prior that
prevents octave errors in the common range also pulls a 195 BPM track down to
97.5. The grid stays musically valid — every detected beat is a real beat, just
half as many — and the ×2 button corrects it in one click. Widening the prior to
catch this would cost accuracy where most music actually sits.

**The jam page keeps no draft.** Leaving `/jam` loses the imported video and every
layer; the engine survives a route change, but nothing is written to disk. Layers
can be pushed to the take library first ("Save as take"), which does persist. The
editor had an IndexedDB draft that stored the media bytes as well as the record —
object URLs die with the document, so a serialised timeline alone would restore a
project of dead sources — and it went with the page. Giving jam a draft means
writing that again, with the same rule.

**The guitar rack is global, not per layer.** All overdubs play through one chain,
so two takes cannot have different tones in the same session.

**A video with no duration in its header imports as zero length.** `probeVideo` in
`useJam` reads `video.duration` and treats a non-finite value as 0 — which is what
`MediaRecorder` output (a screen recording, an OBS webm) has before it is seeked to
the end. The editor had a seek-to-the-end forcing trick for exactly this, because it
produced such files itself; the jam page never needed one and does not have one. If
headerless imports become a real complaint, that is the fix and that is where it goes.

**Bluetooth cannot be a recording input.** A2DP is output-only, so no input
endpoint exists; HFP does provide a mic but only at 8–16 kHz mono with 100–300ms
latency. Web Bluetooth cannot bypass this. The Tank-G's audio-interface path is
USB-C — its Bluetooth is for the preset editor app. The UI warns when a device
looks like Bluetooth, and when the negotiated sample rate is < 32 kHz. The
sample-rate check is the reliable one; device names are only a hint, and macOS
does not include "Bluetooth" in them.
