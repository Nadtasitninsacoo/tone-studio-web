/**
 * POST /api/tone — dial the amp from a sentence, using Claude.
 *
 * ---------------------------------------------------------------------------
 * This route is an **upgrade, not a dependency**.
 *
 * `lib/toneIntent.ts` answers the same question locally, offline and for free, and
 * the client calls it whenever this route is unavailable or does not understand.
 * So the contract here is deliberately lopsided: a missing API key, a rate limit,
 * an overloaded model and a refusal all resolve to "use the local engine", and the
 * player sees a working tone control either way. The only thing that must never
 * happen is this route returning settings the audio graph cannot take.
 *
 * Three consequences worth keeping:
 *
 * - **The key is read inside the handler, never at module scope.** `next build`
 *   evaluates modules while collecting page data; a top-level `new Anthropic()`
 *   would throw there on a machine with no key and fail the build.
 * - **`ANTHROPIC_API_KEY`, not `NEXT_PUBLIC_ANTHROPIC_API_KEY`.** Every
 *   `NEXT_PUBLIC_*` variable is inlined into the client bundle at build time — the
 *   same property that makes `NEXT_PUBLIC_API_URL` safe makes it catastrophic for
 *   a key. This is why the model is called from a route at all rather than from the
 *   browser.
 * - **The model's reply is clamped, not trusted.** `clampAmp` is between the
 *   response and the graph. A model that answers `drive.amount: 4` is not a bug
 *   report, it is Tuesday, and `createAmpChain` must never see it.
 * ---------------------------------------------------------------------------
 */

import Anthropic from '@anthropic-ai/sdk';

import { DEFAULT_AMP } from '@/lib/ampFx';
import { AMP_RANGES, CABINET_IDS, clampAmp } from '@/lib/ampSchema';
import { DEFAULT_BASS } from '@/lib/bassFx';
import { DEFAULT_DRUMS } from '@/lib/drumFx';
import { DEFAULT_VOCALS } from '@/lib/vocalFx';
import { DEFAULT_KEYS } from '@/lib/keysFx';
import { DEFAULT_BRASS } from '@/lib/brassFx';
import { INSTRUMENT_INFO, type Instrument } from '@/lib/rig';
import {
  BASS_RANGES,
  clampBass,
  clampDrums,
  clampVocals,
  clampKeys,
  clampBrass,
  DRUM_RANGES,
} from '@/lib/rigSchema';
import { BASS_LEXICON, DRUM_LEXICON, VOCAL_LEXICON, KEYS_LEXICON, BRASS_LEXICON } from '@/lib/rigLexicon';
import { describePresets } from '@/lib/tonePresets';

/** Longest prompt accepted. A tone request is a sentence, not an essay. */
const MAX_PROMPT_CHARS = 400;

/** Most recent turns sent as context. Enough for "อีกหน่อย" to mean something. */
const MAX_HISTORY = 6;

/**
 * Model, effort and thinking.
 *
 * `medium` effort with thinking left on, rather than thinking disabled for speed:
 * on this model disabling it can put a tool call into the visible text or leak
 * `<thinking>` tags into the response, and a lower effort gets most of the latency
 * back without either failure mode. Dialling fifteen interacting controls from a
 * sentence in Thai is also not the kind of task that wants the shallow end.
 */
const MODEL = 'claude-opus-5';
const EFFORT = 'medium';
const MAX_TOKENS = 8000;

const number = { type: 'number' } as const;
const boolean = { type: 'boolean' } as const;

function object(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** JSON Schema for a guitar reply. Structured outputs reject numeric bounds, so the
 * ranges are documented in the prompt and enforced by the clamp afterwards. */
function guitarSchema() {
  return object({
    inputDb: number,
    gate: object({ enabled: boolean, thresholdDb: number }),
    comp: object({ enabled: boolean, thresholdDb: number, ratio: number }),
    tone: object({ bassDb: number, midDb: number, midHz: number, trebleDb: number }),
    drive: object({
      enabled: boolean,
      amount: number,
      stages: { type: 'integer', enum: [1, 2, 3] },
      bias: number,
    }),
    cab: object({
      enabled: boolean,
      model: { type: 'string', enum: [...CABINET_IDS] },
      presenceDb: number,
      resonanceDb: number,
      width: number,
    }),
    delay: object({ enabled: boolean, timeSec: number, feedback: number, mix: number }),
    reverb: object({ enabled: boolean, sizeSec: number, mix: number }),
    outputDb: number,
    limiter: object({ enabled: boolean, ceilingDb: number }),
  });
}

function bassSchema() {
  return object({
    inputDb: number,
    gate: object({ enabled: boolean, thresholdDb: number }),
    comp: object({ enabled: boolean, thresholdDb: number, ratio: number }),
    crossoverHz: number,
    lowDb: number,
    drive: object({ enabled: boolean, amount: number, bias: number }),
    eq: object({ subDb: number, lowMidDb: number, midDb: number, highDb: number }),
    cab: object({
      enabled: boolean,
      model: { type: 'string', enum: ['b15', 'b410'] },
      presenceDb: number,
      resonanceDb: number,
    }),
    diMix: number,
    outputDb: number,
    limiter: object({ enabled: boolean, ceilingDb: number }),
  });
}

function drumSchema() {
  return object({
    inputDb: number,
    gate: object({ enabled: boolean, thresholdDb: number }),
    eq: object({ kickDb: number, boxDb: number, snapDb: number }),
    drive: object({ enabled: boolean, amount: number }),
    crush: object({ enabled: boolean, thresholdDb: number, ratio: number }),
    punch: number,
    room: object({ enabled: boolean, sizeSec: number, mix: number }),
    glue: object({ enabled: boolean, thresholdDb: number, ratio: number }),
    outputDb: number,
    limiter: object({ enabled: boolean, ceilingDb: number }),
  });
}

function vocalSchema() {
  return object({
    inputDb: number,
    gate: object({ enabled: boolean, thresholdDb: number }),
    deEsser: object({ enabled: boolean, thresholdDb: number, ratio: number }),
    comp: object({ enabled: boolean, thresholdDb: number, ratio: number, attack: number, release: number }),
    eq: object({ lowCutEnabled: boolean, bodyDb: number, presenceDb: number, airDb: number }),
    delay: object({ enabled: boolean, timeMs: number, feedback: number, mix: number }),
    reverb: object({ enabled: boolean, sizeSec: number, mix: number }),
    outputDb: number,
    limiter: object({ enabled: boolean, ceilingDb: number }),
  });
}

function keysSchema() {
  return object({
    inputDb: number,
    gate: object({ enabled: boolean, thresholdDb: number }),
    chorus: object({ enabled: boolean, rateHz: number, depthMs: number, mix: number }),
    comp: object({ enabled: boolean, thresholdDb: number, ratio: number }),
    eq: object({ lowDb: number, midDb: number, highDb: number }),
    reverb: object({ enabled: boolean, sizeSec: number, mix: number }),
    outputDb: number,
    limiter: object({ enabled: boolean, ceilingDb: number }),
  });
}

function brassSchema() {
  return object({
    inputDb: number,
    gate: object({ enabled: boolean, thresholdDb: number }),
    comp: object({ enabled: boolean, thresholdDb: number, ratio: number, attack: number, release: number }),
    eq: object({ lowDb: number, midDb: number, highDb: number }),
    delay: object({ enabled: boolean, timeMs: number, feedback: number, mix: number }),
    reverb: object({ enabled: boolean, sizeSec: number, mix: number }),
    outputDb: number,
    limiter: object({ enabled: boolean, ceilingDb: number }),
  });
}

/** The reply envelope, around whichever instrument's settings schema. */
function replySchema(settings: object) {
  return {
    type: 'object',
    properties: {
      settings,
      /** One line of Thai. The chat shows this above the diff. */
      summary: { type: 'string' },
      /** A preset id when the request maps onto one, else an empty string. */
      presetId: { type: 'string' },
    },
    required: ['settings', 'summary', 'presetId'],
    additionalProperties: false,
  };
}

/** Ranges, as the model needs to see them. Generated so the two cannot drift. */
function describeRanges(ranges: Record<string, readonly [number, number]>): string {
  return Object.entries(ranges)
    .map(([key, [min, max]]) => `${key}: ${min}..${max}`)
    .join(', ');
}

/** A lexicon's presets, as a catalogue for the prompt. */
function describeLexiconPresets(presets: readonly { id: string; label: string; hint: string }[]) {
  return presets.map((preset) => `- ${preset.id} (${preset.label}): ${preset.hint}`).join('\n');
}

/**
 * The shared half of every prompt.
 *
 * Split out because the instrument-specific halves below disagree about almost
 * everything else — signal order, what the EQ is for, what the drive is safe to do —
 * and repeating the parts they *do* share is how two of the three drift.
 */
function commonRules(): string {
  return [
    'Return the complete settings object for what the player asked for, plus a',
    'one-sentence summary in Thai naming what you changed and why. Do not restate',
    'every parameter in the summary; the interface already shows a diff.',
    '',
    'Guidance:',
    '- Change what was asked and what follows from it. Do not re-voice the whole rig',
    '  because one control was mentioned; the settings you were given are the',
    "  player's work.",
    '- A relative request ("อีกหน่อย", "less") is relative to the settings provided.',
    '- Thai popular and Isan styles are the common case.',
    '- Keep the summary short and specific. No preamble, no lists, no markdown.',
  ].join('\n');
}

function bassPrompt(): string {
  return [
    'You are the bass engineer inside a browser recorder. The bass arrives as a dry',
    'DI over USB, and this rig is the entire sound.',
    '',
    `Numeric ranges (values outside these are clamped): ${describeRanges(BASS_RANGES)}.`,
    'eqDb applies to all four EQ bands. cab.model is b15 or b410.',
    '',
    'Signal order:',
    'input trim -> gate -> compressor -> CROSSOVER SPLIT',
    '  low band (below crossoverHz): clean, level set by lowDb',
    '  high band (above crossoverHz): drive -> summed with the low band',
    '-> 4-band graphic EQ -> cabinet -> blended against the DI -> output -> limiter',
    '',
    'The one rule that matters most: **only the band above crossoverHz is driven.**',
    'Distorting a bass fundamental replaces it with harmonics rather than adding to',
    'them, so the note gets smaller. If the player asks for grind or growl, raise the',
    'drive AND raise crossoverHz so more of the fundamental stays clean.',
    '',
    'The EQ bands are named for their job: subDb is 60 Hz (the fundamental, whether',
    'the note is felt), lowMidDb is 250 Hz (where a room turns a bass to cardboard —',
    'usually a cut), midDb is 800 Hz (the note you hear on a phone speaker), highDb',
    'is 2.5 kHz (pick, fret and string noise).',
    '',
    'diMix blends the clean signal from before the drive and cabinet against',
    'everything after them. It is where a bass gets its definition — reach for it',
    'rather than for treble when the player wants to hear the notes more clearly.',
    '',
    'Presets the interface offers, as starting points:',
    describeLexiconPresets(BASS_LEXICON.presets),
    '',
    commonRules(),
  ].join('\n');
}

function drumPrompt(): string {
  return [
    'You are the drum engineer inside a browser recorder. You are handed a kit that',
    'already exists — mics, a room, or a machine — on one stereo bus. There is no',
    'amp and no cabinet.',
    '',
    `Numeric ranges (values outside these are clamped): ${describeRanges(DRUM_RANGES)}.`,
    'eqDb applies to all three EQ bands.',
    '',
    'Signal order:',
    'input trim -> gate -> EQ -> saturation -> SPLIT into three parallel paths',
    '  dry (always at unity) + crushed copy (level = punch) + room',
    '-> summed -> glue compressor -> output -> limiter',
    '',
    'The rule that matters most: **punch is the level of the crushed parallel copy,',
    'and it can only add.** The dry path stays at unity, so punch never removes a',
    'transient. Never reach for the glue compressor to make a kit hit harder — a',
    'compressor in series across a drum bus makes it hit softer, because the',
    'transients are what loud means on a drum. Glue is for cohesion, gently.',
    '',
    'The EQ bands are named for the problem they solve: kickDb is 60 Hz (whether the',
    'kick is felt), boxDb is 400 Hz (the cardboard a small room puts around a snare —',
    'almost always a cut), snapDb is 3.8 kHz (the stick hitting the head).',
    '',
    'The EQ is before the compressors on purpose: they react to what they are fed.',
    '',
    'Presets the interface offers, as starting points:',
    describeLexiconPresets(DRUM_LEXICON.presets),
    '',
    commonRules(),
  ].join('\n');
}

function vocalPrompt(): string {
  return [
    'The vocal strip controls delay, reverb, low cut, de-esser, compressor and EQ.',
    'Common parameters: inputDb, outputDb, gate, limiter.',
    'deEsser: thresholdDb (typically -35 to -20 dB), ratio (1 to 10).',
    'comp: thresholdDb (typically -25 to -15 dB), ratio (2 to 5), attack (0.005 to 0.04), release (0.1 to 0.4).',
    'eq: lowCutEnabled (typically true), bodyDb (lows, around 200Hz), presenceDb (mids, around 2.5kHz), airDb (air shimmer, around 12kHz).',
    'delay: enabled, timeMs (typically 200 to 600 ms), feedback (0 to 0.7), mix (0 to 0.5).',
    'reverb: enabled, sizeSec (typically 1.0 to 3.5 s), mix (0 to 0.4).',
    '',
    'Presets the interface offers, as starting points:',
    describeLexiconPresets(VOCAL_LEXICON.presets),
    '',
    'Always output vocal settings matching this structure.',
    commonRules(),
  ].join('\n');
}

function keysPrompt(): string {
  return [
    'The keyboard channel controls inputDb, outputDb, gate, chorus, compressor, EQ, reverb, and limiter.',
    'chorus: enabled, rateHz (0.1 to 5.0), depthMs (0.1 to 8.0), mix (0 to 1.0).',
    'comp: enabled, thresholdDb (-48 to 0), ratio (1 to 12).',
    'eq: lowDb (-12 to 12, low-shelf), midDb (-12 to 12, peaking), highDb (-12 to 12, high-shelf).',
    'reverb: enabled, sizeSec (0.3 to 5.0), mix (0 to 1.0).',
    '',
    'Presets the interface offers, as starting points:',
    describeLexiconPresets(KEYS_LEXICON.presets),
    '',
    'Always output keyboard settings matching this structure.',
    commonRules(),
  ].join('\n');
}

function brassPrompt(): string {
  return [
    'The brass and woodwind channel controls inputDb, outputDb, gate, compressor, EQ, delay, reverb, and limiter.',
    'comp: enabled, thresholdDb (-48 to 0), ratio (1 to 12), attack (0.001 to 0.1), release (0.01 to 1.0).',
    'eq: lowDb (-12 to 12, low-shelf warmth), midDb (-12 to 12, peaking bite), highDb (-12 to 12, high-shelf air).',
    'delay: enabled, timeMs (50 to 1500), feedback (0 to 0.95), mix (0 to 1.0).',
    'reverb: enabled, sizeSec (0.3 to 5.0), mix (0 to 1.0).',
    '',
    'Presets the interface offers, as starting points:',
    describeLexiconPresets(BRASS_LEXICON.presets),
    '',
    'Always output brass settings matching this structure.',
    commonRules(),
  ].join('\n');
}

/**
 * Everything that differs per instrument, in one table.
 *
 * A single lookup rather than three branches through the handler: the request shape,
 * the validation and the error handling are identical for all three, and the only
 * honest way to keep them identical is to have one copy of them.
 */
const RIGS = {
  guitar: {
    prompt: guitarPrompt,
    schema: guitarSchema,
    clamp: clampAmp as (input: unknown, base: unknown) => unknown,
    fallback: DEFAULT_AMP as unknown,
  },
  bass: {
    prompt: bassPrompt,
    schema: bassSchema,
    clamp: clampBass as (input: unknown, base: unknown) => unknown,
    fallback: DEFAULT_BASS as unknown,
  },
  drums: {
    prompt: drumPrompt,
    schema: drumSchema,
    clamp: clampDrums as (input: unknown, base: unknown) => unknown,
    fallback: DEFAULT_DRUMS as unknown,
  },
  vocals: {
    prompt: vocalPrompt,
    schema: vocalSchema,
    clamp: clampVocals as (input: unknown, base: unknown) => unknown,
    fallback: DEFAULT_VOCALS as unknown,
  },
  keys: {
    prompt: keysPrompt,
    schema: keysSchema,
    clamp: clampKeys as (input: unknown, base: unknown) => unknown,
    fallback: DEFAULT_KEYS as unknown,
  },
  brass: {
    prompt: brassPrompt,
    schema: brassSchema,
    clamp: clampBrass as (input: unknown, base: unknown) => unknown,
    fallback: DEFAULT_BRASS as unknown,
  },
} satisfies Record<Instrument, unknown>;

function readInstrument(value: unknown): Instrument {
  return value === 'bass' || value === 'drums' || value === 'vocals' || value === 'keys' || value === 'brass' ? value : 'guitar';
}

function guitarPrompt(): string {
  return [
    'You are the tone engineer inside a browser guitar recorder. The guitar arrives',
    'as a dry DI over USB, so this amp — cascaded valve stages, a convolution',
    'cabinet, a look-ahead limiter — is the entire sound. There is no real amp in',
    'the room and no cabinet after you.',
    '',
    'Return the complete settings object for what the player asked for, plus a',
    'one-sentence summary in Thai naming what you changed and why. Do not restate',
    'every parameter in the summary; the interface already shows a diff.',
    '',
    'Numeric ranges (values outside these are clamped, which silently loses your',
    `intent, so stay inside them): ${describeRanges(AMP_RANGES)}.`,
    'drive.stages is 1, 2 or 3 cascaded valve stages.',
    `cab.model is one of: ${CABINET_IDS.join(', ')}.`,
    '',
    'Signal order, which constrains what each control can do:',
    'input trim -> gate -> compressor -> tone stack -> drive stages -> cabinet',
    '-> [dry | delay | reverb] -> output trim -> limiter.',
    'The tone stack is BEFORE the drive, so bass/mid/treble decide which harmonics',
    'get generated rather than filtering ones that already exist. The cabinet is',
    'after the drive and rolls off the top; with it disabled the sound is a raw DI.',
    '',
    'Genre modes the interface offers, for reference and as starting points:',
    describePresets(),
    '',
    'Guidance:',
    '- Thai popular and Isan styles are the common case. For morlam, phin and lai',
    '  phin, cut bass rather than boosting it — the part shares its low end with a',
    '  bass guitar and a klong yao — and place the mid peak up at 1.2-1.6 kHz where',
    '  the pick lives.',
    '- Change what was asked and what follows from it. Do not re-voice the whole amp',
    '  because one control was mentioned; the settings you were given are the',
    '  player\'s work.',
    '- A relative request ("อีกหน่อย", "less") is relative to the settings provided.',
    '- Keep the summary short and specific. No preamble, no lists, no markdown.',
  ].join('\n');
}

interface ToneRequestBody {
  prompt?: unknown;
  current?: unknown;
  history?: unknown;
  instrument?: unknown;
}

interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

function readHistory(value: unknown): HistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY)
    .filter((turn): turn is HistoryTurn => {
      if (turn === null || typeof turn !== 'object') return false;
      const { role, text } = turn as Record<string, unknown>;
      return (role === 'user' || role === 'assistant') && typeof text === 'string';
    })
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_PROMPT_CHARS) }));
}

/** Shape the client expects. `code` is what it switches on, not the message. */
function fail(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 503, not 500: nothing is broken, the feature is simply not configured. The
    // client treats this as "use the local engine" and says so once.
    return fail('no-key', 'ANTHROPIC_API_KEY is not set on the server.', 503);
  }

  let body: ToneRequestBody;
  try {
    body = (await request.json()) as ToneRequestBody;
  } catch {
    return fail('bad-request', 'Body must be JSON.', 400);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return fail('bad-request', 'A prompt is required.', 400);

  // Anything but 'bass' or 'drums' is the guitar. A body naming an instrument that
  // does not exist gets the default rather than a 400: the client only ever sends one
  // of the three, so a mismatch is a version skew, and answering for the guitar is a
  // better failure than refusing to answer.
  const instrument = readInstrument(body.instrument);
  const rig = RIGS[instrument];

  // The settings arrive from the browser, so they are as untrusted as the model's
  // reply. Clamping on the way in means the prompt cannot describe an impossible
  // starting point, and the model is never shown a value it must not return.
  const current = rig.clamp(body.current, rig.fallback);
  const history = readHistory(body.history);

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: rig.prompt(),
      output_config: {
        effort: EFFORT,
        format: { type: 'json_schema', schema: replySchema(rig.schema()) },
      },
      messages: [
        ...history.map((turn) => ({ role: turn.role, content: turn.text })),
        {
          role: 'user' as const,
          content: [
            `Instrument: ${INSTRUMENT_INFO[instrument].latin}`,
            'Current settings:',
            JSON.stringify(current),
            '',
            'Request:',
            prompt.slice(0, MAX_PROMPT_CHARS),
          ].join('\n'),
        },
      ],
    });

    // Checked before `content` is read: a refusal returns HTTP 200 with an empty
    // or partial content array, so indexing straight into it is how this becomes
    // a 500 for a request that was answered perfectly clearly.
    if (response.stop_reason === 'refusal') {
      return fail('refusal', 'The model declined this request.', 422);
    }

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    if (!text) return fail('empty', 'The model returned no content.', 502);

    let parsed: { settings?: unknown; summary?: unknown; presetId?: unknown };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      // Structured outputs make this very unlikely and not impossible — a
      // `max_tokens` cut mid-object produces valid-looking truncated JSON.
      return fail('unparseable', 'The model did not return usable JSON.', 502);
    }

    return Response.json({
      settings: rig.clamp(parsed.settings, current),
      summary: typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : 'ปรับให้แล้ว',
      presetId: typeof parsed.presetId === 'string' && parsed.presetId ? parsed.presetId : null,
    });
  } catch (cause) {
    // Typed SDK errors, most specific first. The status is passed through so the
    // client can distinguish "try again in a moment" from "stop trying".
    if (cause instanceof Anthropic.AuthenticationError) {
      return fail('bad-key', 'The server\'s ANTHROPIC_API_KEY was rejected.', 502);
    }
    if (cause instanceof Anthropic.RateLimitError) {
      return fail('rate-limited', 'Rate limited. Try again shortly.', 429);
    }
    if (cause instanceof Anthropic.APIConnectionError) {
      return fail('offline', 'Could not reach the Claude API.', 504);
    }
    if (cause instanceof Anthropic.APIError) {
      return fail('api-error', cause.message, 502);
    }
    return fail('unknown', cause instanceof Error ? cause.message : 'Tone request failed.', 500);
  }
}
