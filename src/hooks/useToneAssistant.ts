'use client';

import { useCallback, useRef, useState } from 'react';

import type { AmpChange } from '@/lib/ampSchema';
import type { Instrument } from '@/lib/rig';
import {
  interpretTone,
  type Lexicon,
  type LexiconPreset,
  type ToneSource,
} from '@/lib/toneIntent';

/**
 * useToneAssistant — the chat and the mode picker, over one amp.
 *
 * ---------------------------------------------------------------------------
 * Local first. Claude only sees what the lexicon could not explain.
 *
 * The order used to be the other way round — every request went to `/api/tone` and
 * fell back locally — which spent a model call on "หนาขึ้นอีกนิด" and on every genre
 * name, both of which `lib/toneIntent` answers exactly, offline, in the same
 * millisecond. That is most requests, so it was most of the quota.
 *
 * The escalation test is `understood` plus `residue`: the local engine reports what
 * it could not account for after removing genre names, rule words, directions,
 * magnitudes and filler. Nothing left over means the lexicon read the whole request
 * and a model would only agree more slowly. Anything substantial left over —
 * "เหมือนในเพลงนี้", an artist, a sentence about a song — is exactly what a model is
 * for, and only that is sent.
 *
 * The fallback is still silent in the other direction: if the route cannot answer
 * (no key, rate limited, offline, refused, nonsense back) the local reading is
 * applied instead. The player is told which engine answered, by the badge on each
 * reply, but is never asked to choose or to retry.
 * ---------------------------------------------------------------------------
 *
 * **Generic over the instrument.** One chat drives three racks: the guitar amp, the
 * bass rig and the drum bus. Everything instrument-specific arrives in the `lexicon`
 * — which words move which controls, which presets exist, how to clamp a reply and
 * how to describe the difference — so this file contains no mention of a knob. The
 * `instrument` is sent to the route as well, because the model needs to be told which
 * of the three it is dialling.
 *
 * Undo is per message and stores the **settings before that reply**, not a stack of
 * deltas. A player who asks for four changes and dislikes the second wants that one
 * reverted, not the last three replayed backwards.
 */

export interface ToneMessage<S> {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Assistant only: what moved. Empty means understood but nothing to change. */
  changes?: AmpChange[];
  /** Assistant only: which engine answered. */
  source?: ToneSource;
  /** Assistant only: settings to restore if this reply is undone. */
  before?: S;
  /** Assistant only: true when neither engine understood the request. */
  stuck?: boolean;
}

/** What the route returns on success. Mirrors `app/api/tone/route.ts`. */
interface ToneReply {
  settings: unknown;
  summary: unknown;
  presetId: unknown;
}

/**
 * How much unexplained text is worth a model call, in characters.
 *
 * Low enough that a real question escalates, high enough that a stray word does
 * not: "หมอลำ แต่หนาๆ" leaves nothing, "หมอลำแบบวงดังๆ" leaves "วงดัง", and one
 * unmatched syllable is not worth a round trip.
 */
const ESCALATE_RESIDUE_CHARS = 5;

export interface ToneAssistant<S> {
  messages: ToneMessage<S>[];
  isThinking: boolean;
  /**
   * Whether the server has a key, as far as we know.
   *
   * `null` until the first request answers the question — the UI must not claim
   * either way before then, and it must not probe on mount: that would fire a
   * request for a feature the player has not asked for.
   */
  hasClaude: boolean | null;
  send: (prompt: string) => Promise<void>;
  applyPreset: (preset: LexiconPreset<S>) => void;
  undo: (messageId: number) => void;
  clear: () => void;
}

export function useToneAssistant<S>(
  settings: S,
  onChange: (next: S) => void,
  lexicon: Lexicon<S>,
  instrument: Instrument,
): ToneAssistant<S> {
  const [messages, setMessages] = useState<ToneMessage<S>[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [hasClaude, setHasClaude] = useState<boolean | null>(null);

  /** Message ids. A counter, not a timestamp: two messages can share a millisecond. */
  const nextId = useRef(1);
  const mint = () => {
    nextId.current += 1;
    return nextId.current;
  };

  /** Stable, so the callbacks below can depend on it without being rebuilt. */
  const push = useCallback((message: ToneMessage<S>) => {
    setMessages((current) => [...current, message]);
  }, []);

  const applyPreset = useCallback(
    (preset: LexiconPreset<S>) => {
      const before = settings;
      onChange(preset.settings);
      push({
        id: mint(),
        role: 'assistant',
        text: `โหมด ${preset.label} — ${preset.hint}`,
        changes: lexicon.diff(before, preset.settings),
        source: 'preset',
        before,
      });
    },
    [settings, lexicon, onChange, push],
  );

  const send = useCallback(
    async (prompt: string) => {
      const text = prompt.trim();
      if (!text || isThinking) return;

      // `settings` comes from the deps rather than a ref, so a request that follows
      // a knob drag starts from what the player is actually hearing. A ref read
      // during render would be one commit stale — and every relative request
      // ("อีกหน่อย") would be relative to the wrong starting point.
      const before = settings;
      push({ id: mint(), role: 'user', text });

      // The local engine reads it first — always, and before anything is sent.
      const local = interpretTone(text, before, lexicon);
      if (local.understood && local.residue.length < ESCALATE_RESIDUE_CHARS) {
        onChange(local.settings);
        push({
          id: mint(),
          role: 'assistant',
          text: local.summary,
          changes: local.changes,
          source: local.source,
          before,
        });
        return;
      }

      setIsThinking(true);

      // History for the model, taken before this turn was pushed. Only the text is
      // sent — the diffs are ours, and replaying them would spend tokens on
      // something the model can read off the settings object anyway.
      const history = messages.slice(-6).map((message) => ({
        role: message.role,
        text: message.text,
      }));

      try {
        const response = await fetch('/api/tone', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: text, current: before, history, instrument }),
        });

        if (response.ok) {
          const reply = (await response.json()) as ToneReply;
          const proposed = lexicon.clamp(reply.settings, before);
          const changes = lexicon.diff(before, proposed);

          if (changes.length > 0) {
            setHasClaude(true);
            onChange(proposed);
            push({
              id: mint(),
              role: 'assistant',
              text: typeof reply.summary === 'string' ? reply.summary : 'ปรับให้แล้ว',
              changes,
              source: 'claude',
              before,
            });
            return;
          }
          // Answered, but nothing moved. Falls through to the local reading, which
          // treats a relative request ("อีกหน่อย") as a step rather than as a target
          // that is already met.
          setHasClaude(true);
        } else {
          // 503 means no key on the server; anything else is a transient failure.
          // Either way the local engine takes the turn.
          const body = (await response.json().catch(() => null)) as { code?: string } | null;
          if (body?.code === 'no-key') setHasClaude(false);
        }
      } catch {
        // Network failure. Nothing to report beyond the badge on the reply.
      } finally {
        setIsThinking(false);
      }

      // The route could not answer, so the local reading stands — even a partial one.
      // `stuck` when it understood nothing at all, which is the only case where
      // there is genuinely nothing to apply.
      if (!local.understood) {
        push({ id: mint(), role: 'assistant', text: local.summary, source: 'local', stuck: true });
        return;
      }

      onChange(local.settings);
      push({
        id: mint(),
        role: 'assistant',
        text: local.summary,
        changes: local.changes,
        source: local.source,
        before,
      });
    },
    [settings, instrument, lexicon, isThinking, messages, onChange, push],
  );

  const undo = useCallback(
    (messageId: number) => {
      // Looked up outside the updater: React may call an updater twice, and
      // restoring the amp is a side effect that must happen exactly once.
      const target = messages.find((message) => message.id === messageId);
      if (!target?.before) return;
      onChange(target.before);
      // The reply stays in the log with its changes cleared, so the transcript
      // still reads as a conversation rather than losing a turn.
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, changes: [], before: undefined } : message,
        ),
      );
    },
    [messages, onChange],
  );

  const clear = useCallback(() => setMessages([]), []);

  return { messages, isThinking, hasClaude, send, applyPreset, undo, clear };
}

/**
 * The mode currently in effect, or null once anything has been edited.
 *
 * Compared by value rather than by remembering which chip was pressed: the player can
 * reach a mode's exact settings by dragging knobs, by undo, or by the chat, and all
 * three should light the chip. The moment one knob moves, none of them should.
 */
export function activePresetOf<S>(
  settings: S,
  presets: readonly LexiconPreset<S>[],
): LexiconPreset<S> | null {
  const encoded = JSON.stringify(settings);
  return presets.find((preset) => JSON.stringify(preset.settings) === encoded) ?? null;
}
