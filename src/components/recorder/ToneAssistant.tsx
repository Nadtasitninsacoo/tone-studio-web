'use client';

import { CornerUpLeft, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { activePresetOf, useToneAssistant } from '@/hooks/useToneAssistant';
import type { AmpChange } from '@/lib/ampSchema';
import type { Instrument } from '@/lib/rig';
import type { Lexicon, ToneSource } from '@/lib/toneIntent';

interface ToneAssistantProps<S> {
  settings: S;
  onChange: (settings: S) => void;
  /** Which words move which controls, and this instrument's modes. */
  lexicon: Lexicon<S>;
  /** Sent to the route so the model knows which rack it is dialling. */
  instrument: Instrument;
  /** Accent colour, as a CSS value. Matches the knobs. */
  accent: string;
  /** Dimmed with the rest of the rack when the chain is not passing audio. */
  isLive: boolean;
}

/** Example prompts, shown until the player has typed something of their own. */
const EXAMPLES = ['หนาขึ้นอีกนิด', 'แตกแบบกองยาว', 'ใสๆ แต่อย่าบาง', 'ก้องเยอะๆ'];

/** How each engine is labelled on a reply. The distinction is not cosmetic. */
const SOURCE_BADGE: Record<ToneSource, { label: string; title: string }> = {
  claude: { label: 'claude', title: 'ตอบโดย Claude ผ่าน /api/tone' },
  local: { label: 'ในเครื่อง', title: 'ตอบโดยตัวแปลคำสั่งในเครื่อง — ไม่ได้ใช้เน็ต' },
  preset: { label: 'โหมด', title: 'ค่าจากโหมดเพลงที่เลือก ไม่ได้ผ่านการตีความ' },
};

/**
 * ToneAssistant — pick a genre, or just say what you want.
 *
 * ---------------------------------------------------------------------------
 * A full-width strip under the rack's columns, and why.
 *
 * It began as a fourth block inside the amp's first column, to fill the space the
 * short front-end column left. That was wrong twice over: it is not a stage in the
 * signal chain, so it read as one where it sat, and at ~420px tall in a one-third
 * column there was nothing to balance it against — it just moved the hole to
 * another column. Full width it is ~150px tall, the twelve modes lay out six across
 * instead of two, and the columns above it balance on their own.
 *
 * Everything inside is driven by **its own** `@container` query, not the rack's.
 * The same component has to work at 1500px on the dashboard and at 240px in the jam
 * rail, where it collapses to one column, two modes across, chat underneath.
 * ---------------------------------------------------------------------------
 *
 * Each reply carries the diff it applied and its own undo. That pairing is the whole
 * trust model: a tone control driven by a sentence is only usable if you can see
 * what it did and put it back in one tap.
 */
export function ToneAssistant<S>({
  settings,
  onChange,
  lexicon,
  instrument,
  accent,
  isLive,
}: ToneAssistantProps<S>) {
  const { messages, isThinking, hasClaude, send, applyPreset, undo, clear } = useToneAssistant(
    settings,
    onChange,
    lexicon,
    instrument,
  );
  const [draft, setDraft] = useState('');
  const active = activePresetOf(settings, lexicon.presets);

  const logRef = useRef<HTMLDivElement>(null);
  // Keep the newest reply in view. Runs after paint on a message change, not
  // during render, and touches the DOM directly — routing scroll position through
  // state would re-render the rack for something React does not own.
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const selected = {
    borderColor: accent,
    color: accent,
    backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void send(text);
  };

  return (
    <section className="@container rounded-lg border border-line bg-base p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[9px] font-semibold tracking-[0.16em] uppercase text-ink-3">
          <Sparkles aria-hidden className="h-3 w-3" style={{ color: accent }} />
          ปรับโทนด้วย AI
        </p>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            title="ล้างบทสนทนา"
            aria-label="ล้างบทสนทนา"
            className="rounded p-1 text-ink-3 transition-colors duration-200 hover:text-ink"
          >
            <Trash2 aria-hidden className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {/* Modes and chat side by side once there is room for both. Below 42rem —
          the jam rail, a phone — they stack, which is why this is a grid and not a
          flex row with a fixed basis. */}
      <div className="grid gap-2 @2xl:grid-cols-[minmax(0,1fr)_20rem] @4xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="grid grid-cols-2 gap-1 @md:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-6">
        {lexicon.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyPreset(preset)}
            title={preset.hint}
            aria-pressed={active?.id === preset.id}
            className="flex flex-col items-start rounded border border-line bg-panel px-1.5 py-1 text-left transition-colors duration-200 hover:border-line-strong"
            style={active?.id === preset.id ? selected : undefined}
          >
            <span className="w-full truncate text-[11px] font-semibold leading-tight">
              {preset.label}
            </span>
            {/* The romanised name where the preset carries one. Every instrument's
                presets satisfy `LexiconPreset`, and only the guitar's genre modes add
                `latin` on top of it. */}
            <span className="w-full truncate font-mono text-[8px] uppercase tracking-wider text-ink-3">
              {'latin' in preset ? String(preset.latin) : preset.id}
            </span>
          </button>
        ))}
      </div>

      {/* ---- Chat column ---------------------------------------------------- */}
      <div className="flex min-w-0 flex-col">
      {/* Transcript: fixed height and its own scroll. Letting it grow would push
          the page down every time a reply arrived. */}
      {messages.length > 0 ? (
        <div
          ref={logRef}
          className="mb-2 flex max-h-52 flex-1 flex-col gap-1.5 overflow-y-auto rounded border border-line bg-canvas p-1.5"
        >
          {messages.map((message) =>
            message.role === 'user' ? (
              <p
                key={message.id}
                className="self-end rounded-md rounded-br-none border border-line bg-panel px-1.5 py-1 text-[11px] leading-snug text-ink-2"
              >
                {message.text}
              </p>
            ) : (
              <div
                key={message.id}
                className={`rounded-md rounded-bl-none border px-1.5 py-1 ${
                  message.stuck ? 'border-line bg-inset' : 'border-line bg-panel'
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <p className="flex-1 text-[11px] leading-snug text-ink">{message.text}</p>
                  {message.before ? (
                    <button
                      type="button"
                      onClick={() => undo(message.id)}
                      title="ย้อนกลับค่าก่อนหน้า"
                      aria-label="ย้อนกลับ"
                      className="shrink-0 rounded p-0.5 text-ink-3 transition-colors duration-200 hover:text-ink"
                    >
                      <CornerUpLeft aria-hidden className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>

                {message.changes && message.changes.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {message.changes.map((change) => (
                      <ChangeChip key={change.label} change={change} accent={accent} />
                    ))}
                  </ul>
                ) : null}

                {message.source ? (
                  <p
                    title={SOURCE_BADGE[message.source].title}
                    className="mt-1 font-mono text-[8px] tracking-wider uppercase text-ink-3"
                  >
                    {SOURCE_BADGE[message.source].label}
                  </p>
                ) : null}
              </div>
            ),
          )}
        </div>
      ) : null}

      {/* ---- Input ----------------------------------------------------------- */}
      <div className="mt-auto flex items-center gap-1">
        <input
          value={draft}
          maxLength={400}
          disabled={!isLive}
          placeholder="บอกเสียงที่อยากได้…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
          aria-label="บอกเสียงที่อยากได้"
          className="min-w-0 flex-1 rounded-md border border-line bg-inset px-2 py-1 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong disabled:opacity-40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || isThinking}
          title="ส่ง"
          aria-label="ส่ง"
          className="shrink-0 rounded-md border p-1.5 transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40"
          style={draft.trim() ? selected : undefined}
        >
          {isThinking ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send aria-hidden className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {messages.length === 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void send(example)}
              className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3 transition-colors duration-200 hover:text-ink"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {/* Said plainly rather than implied. Two engines answer these requests, they
          are not equally clever, and only one of them costs anything — a badge on
          each reply says which one did. */}
      <p className="mt-1.5 text-[9px] leading-snug text-ink-3">
        {hasClaude === false
          ? 'ตัวแปลในเครื่องอ่านให้ก่อนเสมอ — เข้าใจคำอย่าง หนา บาง ใส แตก ก้อง แน่น ชื่อแนวเพลง และสะกดผิดได้บ้าง ส่วนที่เกินกว่านั้นต้องตั้ง ANTHROPIC_API_KEY ที่เซิร์ฟเวอร์'
          : 'ตัวแปลในเครื่องอ่านให้ก่อนเสมอ ไม่เสียโควตา เหลือเฉพาะที่มันอ่านไม่ออก เช่น "เหมือนในเพลงนี้" จึงส่งให้ Claude'}
      </p>
      </div>
      </div>
    </section>
  );
}

/**
 * One changed parameter.
 *
 * Both values, not just the new one: "+2 → +5" tells the player how far it moved
 * and gives them the number to type back if they disagree.
 */
function ChangeChip({ change, accent }: { change: AmpChange; accent: string }) {
  return (
    <li
      className="inline-flex items-center gap-1 rounded border border-line bg-inset px-1 py-0.5 font-mono text-[9px] whitespace-nowrap text-ink-2"
      style={{ borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }}
    >
      <span className="tracking-wider uppercase text-ink-3">{change.label}</span>
      <span className="text-ink-3">{change.from}</span>
      <span aria-hidden style={{ color: accent }}>
        →
      </span>
      <span className="font-numeric">{change.to}</span>
    </li>
  );
}
