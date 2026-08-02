'use client';

import { Download, FileAudio, Loader2, Pause, Play, SkipBack, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Chip, Panel } from '@/components/ui/Panel';
import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { useCanvasPalette } from '@/hooks/useCanvasPalette';
import { formatDb } from '@/lib/audio';
import {
  formatBytes,
  formatChannels,
  formatDuration,
  formatSampleRate,
  formatStamp,
} from '@/lib/format';
import type { Take } from '@/types/recorder';

interface TakePlayerProps {
  take: Take | null;
  onDelete: (id: string) => void;
  /**
   * Render this take through the amp and hand back a WAV.
   *
   * Passed in rather than done here: the amp settings live with the recorder, and a
   * player that reached for them would be reading state it has no business knowing.
   */
  onExportWithAmp: (take: Take) => Promise<{ blob: Blob; name: string } | null>;
  /** True while an offline render is running. */
  isExporting: boolean;
}

/** Shared styling for the round icon actions — larger hit area on touch screens. */
const ICON_ACTION =
  'flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-line bg-raised text-ink-2 backdrop-blur-sm transition-all duration-300 active:scale-95 sm:h-9 sm:w-9';

/**
 * TakePlayer — player card for the selected take.
 *
 * Wraps a real <audio> element (so the browser handles decoding and seeking) and
 * draws the waveform from the envelope captured at record time — no second decode
 * pass, no extra memory held for the peaks.
 */
export function TakePlayer({
  take,
  onDelete,
  onExportWithAmp,
  isExporting,
}: TakePlayerProps) {
  /** Finished amp render, offered beside the button that produced it. */
  const [ampFile, setAmpFile] = useState<{ url: string; name: string } | null>(null);

  // The object URL is ours, so it has to be revoked — both when it is replaced and
  // when this card unmounts, which happens on every take change (the parent keys it
  // on the take id).
  useEffect(() => {
    return () => {
      if (ampFile) URL.revokeObjectURL(ampFile.url);
    };
  }, [ampFile]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const palette = useCanvasPalette();

  // Transport state resets by remount: the parent keys this component on take.id,
  // which is cheaper and less error-prone than syncing state in an effect.

  /** Paint the static envelope, with the played portion highlighted. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !take) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const midline = height / 2;
    const peaks = take.peaks;

    ctx.clearRect(0, 0, width, height);

    const step = 3;
    const columns = Math.max(1, Math.floor(width / step));
    const playedColumns = progressRef.current * columns;

    for (let column = 0; column < columns; column += 1) {
      // Map canvas columns onto envelope buckets (peaks is a fixed-length array).
      const bucket = Math.floor((column / columns) * peaks.length);
      const value = peaks[bucket] ?? 0;
      const barHeight = Math.max(1, value * (midline - 2));

      // Played portion in the ambient accent, unplayed left faint.
      ctx.fillStyle = column <= playedColumns ? palette.cyan : palette.ink3;
      ctx.globalAlpha = column <= playedColumns ? 1 : 0.6;
      ctx.fillRect(column * step, midline - barHeight, step - 1, barHeight * 2);
    }

    ctx.globalAlpha = 1;

    // Playhead.
    if (progressRef.current > 0) {
      ctx.fillStyle = palette.cyan;
      ctx.fillRect(Math.min(width - 1.5, progressRef.current * width), 0, 1.5, height);
    }
  }, [take, palette]);

  // Match the canvas backing store to its CSS box, then repaint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  // Repaint on take change and on theme change (palette is a dependency of draw).
  useEffect(() => draw(), [draw]);

  // Advance the playhead at display rate, only while playing.
  useAnimationFrame(() => {
    const audio = audioRef.current;
    if (!audio || !take) return;
    progressRef.current = take.durationSec > 0 ? audio.currentTime / take.durationSec : 0;
    setCurrentTime(audio.currentTime);
    draw();
  }, isPlaying);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const restart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    progressRef.current = 0;
    setCurrentTime(0);
    draw();
  };

  /** Tap or click anywhere on the waveform to seek. */
  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !take) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    audio.currentTime = ratio * take.durationSec;
    progressRef.current = ratio;
    setCurrentTime(audio.currentTime);
    draw();
  };

  if (!take) {
    return (
      <Panel title="Player" icon={<FileAudio aria-hidden className="h-3.5 w-3.5" />}>
        <div className="flex h-full min-h-44 flex-col items-center justify-center gap-2 text-center sm:min-h-52">
          <FileAudio aria-hidden className="h-8 w-8 text-ink-3 opacity-50" />
          <p className="text-sm text-ink-2">No take loaded</p>
          <p className="max-w-xs text-xs text-ink-3">
            Hit record to capture your first take. It will land here as a 16-bit WAV, ready to
            audition and download.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Player"
      icon={<FileAudio aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone="muted" className="hidden sm:inline-flex">
            {formatSampleRate(take.sampleRate)}
          </Chip>
          <Chip tone="muted">{formatChannels(take.channels)}</Chip>
          <Chip tone={take.peakDb > -0.3 ? 'danger' : take.peakDb > -3 ? 'hot' : 'strong'}>
            Peak {formatDb(take.peakDb)}
          </Chip>
        </>
      }
    >
      {/* Hidden native element does the actual decoding and playback */}
      <audio
        ref={audioRef}
        src={take.url}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          progressRef.current = 0;
          setCurrentTime(0);
          draw();
        }}
      />

      <div className="flex flex-col gap-3.5 sm:gap-4">
        {/* File identity */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-[13px] font-medium text-ink sm:text-sm">
              {take.name}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-ink-3">
              {formatStamp(take.createdAt)} · {formatBytes(take.sizeBytes)}
            </p>
            <p className="truncate text-[11px] text-ink-3">{take.deviceLabel}</p>

            {/* The amp render, offered next to the take it came from. Green-ish
                accent, not red: this is a success, and red means live or broken. */}
            {ampFile ? (
              <a
                href={ampFile.url}
                download={ampFile.name}
                className="mt-1.5 inline-flex max-w-full animate-pop-in items-center gap-1.5 rounded-md border border-teal/45 bg-teal/8 px-2 py-1 font-mono text-[10px] text-teal transition-colors duration-200 hover:bg-teal/15"
              >
                <Download aria-hidden className="h-3 w-3 shrink-0" />
                <span className="truncate">{ampFile.name}</span>
              </a>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={take.downloadUrl}
              download={take.name}
              title="Download the dry WAV — exactly what was captured"
              aria-label={`Download ${take.name}`}
              className={`${ICON_ACTION} hover:border-cyan/45 hover:bg-cyan/10 hover:text-cyan`}
            >
              <Download aria-hidden className="h-4 w-4" />
            </a>

            {/* Print the amp. A second file, never a replacement: the dry take is
                the performance and stays exactly as captured. */}
            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                void (async () => {
                  const result = await onExportWithAmp(take);
                  if (!result) return;
                  if (ampFile) URL.revokeObjectURL(ampFile.url);
                  setAmpFile({ url: URL.createObjectURL(result.blob), name: result.name });
                })();
              }}
              title="Render a second WAV with the amp and cabinet printed in"
              aria-label={`Export ${take.name} with the amp`}
              className={`${ICON_ACTION} hover:border-violet/50 hover:bg-violet/10 hover:text-violet disabled:pointer-events-none disabled:opacity-50`}
            >
              {isExporting ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <Zap aria-hidden className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onDelete(take.id)}
              title="Delete take"
              aria-label={`Delete ${take.name}`}
              className={`${ICON_ACTION} hover:border-rec/50 hover:bg-rec/8 hover:text-rec`}
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Waveform / scrub area */}
        <div
          onClick={seekFromEvent}
          role="slider"
          tabIndex={0}
          aria-label="Seek position"
          aria-valuemin={0}
          aria-valuemax={Math.round(take.durationSec)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={formatDuration(currentTime)}
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (event.key === 'ArrowRight') audio.currentTime += 5;
            if (event.key === 'ArrowLeft') audio.currentTime -= 5;
          }}
          className="h-20 cursor-pointer touch-manipulation overflow-hidden rounded-xl border border-line bg-inset transition-colors duration-200 hover:border-cyan/40 sm:h-24 lg:h-28"
        >
          <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
        </div>

        {/* Playback transport */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause playback' : 'Play take'}
            className="flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-full border border-cyan/45 bg-cyan/12 text-cyan transition-all duration-300 ease-out-expo hover:-translate-y-0.5 hover:bg-cyan/20 active:translate-y-0 active:scale-95 sm:h-11 sm:w-11"
          >
            {isPlaying ? (
              <Pause aria-hidden className="h-4 w-4 fill-current" />
            ) : (
              <Play aria-hidden className="h-4 w-4 translate-x-0.5 fill-current" />
            )}
          </button>

          <button
            type="button"
            onClick={restart}
            aria-label="Return to start"
            title="Return to start"
            className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-line bg-raised text-ink-3 transition-all duration-200 hover:border-line-strong hover:text-ink active:scale-95 sm:h-9 sm:w-9"
          >
            <SkipBack aria-hidden className="h-4 w-4" />
          </button>

          <span className="ml-auto font-numeric text-sm text-ink">
            {formatDuration(currentTime)}
            <span className="text-ink-3"> / {formatDuration(take.durationSec)}</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}
