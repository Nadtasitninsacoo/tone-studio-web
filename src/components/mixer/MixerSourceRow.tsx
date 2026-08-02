'use client';

import { AudioLines, FileAudio, Radio, Trash2 } from 'lucide-react';
import { useId, useRef } from 'react';

import { useMixerStudio, useRecorderStudio } from '@/components/providers/StudioProviders';
import { formatDuration } from '@/lib/format';

/**
 * MixerSourceRow — what each strip is actually playing.
 *
 * The missing half of a console: a fader can only change the level of something, and
 * until a strip has a source there is nothing for any of its controls to do. Three
 * kinds, one row per strip, in the order they get used:
 *
 * - **LIVE** — the input device, through this strip's rack. Several strips can take it
 *   at once (a dry DI beside an amped channel), which costs nothing extra because
 *   `lib/inputSession` opens the device once and hands out taps.
 * - **A take** — anything in the shared library, recorded on the recorder page. This is
 *   why the mixer has no record button of its own: capture already exists, is already
 *   verified against hardware, and a take is in the library the moment it is stopped.
 * - **A file** — dropped in from disk for a backing track or a stem.
 *
 * Deliberately a plain `<select>` for takes rather than a custom listbox: the list is
 * text, it can be long, and a native control gets keyboard support, typeahead and a
 * usable phone picker for free.
 */
export function MixerSourceRow() {
  const mixer = useMixerStudio();
  const { library } = useRecorderStudio();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingChannelRef = useRef<string | null>(null);
  const fileInputId = useId();

  const { state, loadTake, loadFile, takeLiveInput, clearChannel, nudgeChannel, channelLength } =
    mixer;

  const openFilePicker = (channelId: string) => {
    pendingChannelRef.current = channelId;
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-3">
          Channel sources
        </span>
        <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-3">
          {library.takes.length} take{library.takes.length === 1 ? '' : 's'} available
        </span>
      </div>

      {/* One hidden input for every strip: the pending channel id is what decides
          where the file lands, so eight inputs are unnecessary. */}
      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const channelId = pendingChannelRef.current;
          // Cleared immediately so choosing the same file twice still fires a change.
          event.target.value = '';
          pendingChannelRef.current = null;
          if (file && channelId) void loadFile(channelId, file);
        }}
      />

      <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-4">
        {state.channels.map((channel) => {
          const source = channel.source;
          const isLive = source.kind === 'live';
          // Narrowed once and reused: the union has to be discriminated before any of
          // its fields can be read, and doing it per JSX branch reads worse.
          const clip = source.kind === 'clip' ? source : null;
          const length = channelLength(channel);

          return (
            <div
              key={channel.id}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-inset px-2 py-1.5"
            >
              <span className="w-14 shrink-0 truncate font-mono text-[9px] tracking-[0.12em] uppercase text-ink-2">
                {channel.name}
              </span>

              <button
                type="button"
                onClick={() => takeLiveInput(channel.id)}
                aria-pressed={isLive}
                title="Take the live input on this channel"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors ${
                  isLive
                    ? 'border-cyan/50 bg-cyan/12 text-cyan'
                    : 'border-line bg-raised text-ink-3 hover:text-ink-2'
                }`}
              >
                <Radio aria-hidden className="h-3 w-3" />
              </button>

              <button
                type="button"
                onClick={() => openFilePicker(channel.id)}
                title="Load an audio file onto this channel"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-raised text-ink-3 transition-colors hover:text-ink-2"
              >
                <FileAudio aria-hidden className="h-3 w-3" />
              </button>

              <select
                aria-label={`Source for ${channel.name}`}
                value={clip ? (clip.takeId ?? 'clip') : source.kind}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'empty') {
                    clearChannel(channel.id);
                    return;
                  }
                  if (value === 'live') {
                    takeLiveInput(channel.id);
                    return;
                  }
                  const take = library.takes.find((entry) => entry.id === value);
                  if (take) void loadTake(channel.id, take);
                }}
                className="min-w-0 flex-1 rounded border border-line bg-raised px-1.5 py-1 font-mono text-[9px] text-ink-2 outline-none focus-visible:border-cyan/50"
              >
                <option value="empty">— empty —</option>
                <option value="live">live input</option>
                {/* A clip loaded from a file has no take id, so it needs its own row or
                    the select would show "empty" for something that is playing. */}
                {clip && !clip.takeId ? <option value="clip">{clip.name}</option> : null}
                {library.takes.map((take) => (
                  <option key={take.id} value={take.id}>
                    {take.name}
                  </option>
                ))}
              </select>

              {clip ? (
                <>
                  <span
                    title={`Starts at ${channel.offsetSec.toFixed(2)}s, ${formatDuration(length)} long`}
                    className="hidden shrink-0 font-mono text-[9px] text-ink-3 sm:inline"
                  >
                    {formatDuration(length)}
                  </span>
                  {/* Nudge in tenths: the only time control a channel needs when it
                      holds one clip rather than a timeline. */}
                  <button
                    type="button"
                    onClick={() => nudgeChannel(channel.id, -0.1)}
                    title="Start 100 ms earlier"
                    className="h-6 w-5 shrink-0 rounded border border-line bg-raised font-mono text-[9px] text-ink-3 hover:text-ink-2"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeChannel(channel.id, 0.1)}
                    title="Start 100 ms later"
                    className="h-6 w-5 shrink-0 rounded border border-line bg-raised font-mono text-[9px] text-ink-3 hover:text-ink-2"
                  >
                    ›
                  </button>
                </>
              ) : (
                <AudioLines aria-hidden className="h-3 w-3 shrink-0 text-ink-3" />
              )}

              <button
                type="button"
                onClick={() => clearChannel(channel.id)}
                title="Clear this channel"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-raised text-ink-3 transition-colors hover:border-rec/40 hover:text-rec"
              >
                <Trash2 aria-hidden className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
