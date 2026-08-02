'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { useCanvasPalette } from '@/hooks/useCanvasPalette';
import type { MeterSnapshot, RecorderStatus } from '@/types/recorder';

interface LiveWaveformProps {
  meterRef: RefObject<MeterSnapshot>;
  status: RecorderStatus;
  active: boolean;
  getAnalyserNode: (channel: number) => AnalyserNode | null;
}

export function LiveWaveform({ meterRef, status, active, getAnalyserNode }: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palette = useCanvasPalette();

  // Keep the palette in a ref so the draw loop never restarts on a theme change.
  const paletteRef = useRef(palette);
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  // Caching arrays to avoid per-frame GC allocations
  const timeDomainBuffer = useRef<Float32Array<ArrayBuffer> | null>(null);
  const frequencyBuffer = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const isRecording = status === 'recording';

  // Handle high-DPR canvas scaling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Clear the canvas when disarmed
  useEffect(() => {
    if (active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
  }, [active]);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const colors = paletteRef.current;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const midline = height / 2;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Digital Grid Backdrop
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 0.5;
    const gridSpacing = 24;

    // Horizontal grid lines
    for (let y = gridSpacing; y < height; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    // Vertical grid lines
    for (let x = gridSpacing; x < width; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Reference midline
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midline);
    ctx.lineTo(width, midline);
    ctx.stroke();

    const analyser = active ? getAnalyserNode(0) : null;

    if (analyser) {
      // Initialize caches if needed
      if (!timeDomainBuffer.current || timeDomainBuffer.current.length !== analyser.fftSize) {
        timeDomainBuffer.current = new Float32Array(analyser.fftSize);
      }
      if (!frequencyBuffer.current || frequencyBuffer.current.length !== analyser.frequencyBinCount) {
        frequencyBuffer.current = new Uint8Array(analyser.frequencyBinCount);
      }

      const timeData = timeDomainBuffer.current;
      const freqData = frequencyBuffer.current;

      analyser.getFloatTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      // 2. Draw Frequency Spectrum (Neon Bars at the bottom)
      const barCount = 48;
      const barWidth = Math.max(1, width / barCount - 2);
      const binSize = Math.floor(freqData.length / barCount);

      // Create a nice gradient for spectrum bars
      const barGrad = ctx.createLinearGradient(0, height, 0, height - 60);
      barGrad.addColorStop(0, 'rgba(18, 131, 118, 0.05)'); // teal transparent
      barGrad.addColorStop(0.5, 'rgba(18, 127, 144, 0.35)'); // cyan soft
      barGrad.addColorStop(1, 'rgba(122, 24, 248, 0.6)'); // violet neon

      ctx.fillStyle = barGrad;

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < binSize; j++) {
          sum += freqData[i * binSize + j] || 0;
        }
        const val = sum / binSize;
        const barHeight = (val / 255) * (height * 0.75); // max 75% height
        const bx = i * (barWidth + 2);
        const by = height - barHeight;
        ctx.fillRect(bx, by, barWidth, barHeight);
      }

      // 3. Draw Oscilloscope Wave (Glowing Cyan Waveform)
      ctx.beginPath();
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = isRecording ? colors.recSoft : colors.cyan;

      // Glow effect on active line
      ctx.shadowColor = isRecording ? colors.rec : colors.cyan;
      ctx.shadowBlur = 8;

      const sliceWidth = width / timeData.length;
      let x = 0;

      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i];
        const y = midline + v * (height / 2.2);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();

      // Reset shadow for overlays
      ctx.shadowBlur = 0;

      // 4. Render Digital Lab HUD Metrics
      ctx.fillStyle = colors.ink3;
      ctx.font = '7px var(--font-mono)';
      ctx.textBaseline = 'top';

      // Left stats
      ctx.fillText(`MODE: ${isRecording ? 'CAPTURE [ON AIR]' : 'MONITOR'}`, 12, 10);
      ctx.fillText(`GAIN: ${((meterRef.current?.rms[0] ?? 0) > 0 ? (20 * Math.log10(meterRef.current!.rms[0])).toFixed(1) : '-∞')} dB`, 12, 20);

      // Right stats
      ctx.textAlign = 'right';
      ctx.fillText(`RATE: ${analyser.context.sampleRate / 1000} kHz`, width - 12, 10);
      ctx.fillText(`FFT: ${analyser.fftSize} BINS`, width - 12, 20);
      ctx.textAlign = 'left';
    } else {
      // Standby / Empty State: slowly pulsing flat line
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.line;
      ctx.moveTo(0, midline);
      ctx.lineTo(width, midline);
      ctx.stroke();

      // Animated scanner overlay
      const now = performance.now();
      const scanX = (now * 0.15) % (width + 100) - 50;
      const scanGrad = ctx.createLinearGradient(scanX - 50, 0, scanX + 50, 0);
      scanGrad.addColorStop(0, 'transparent');
      scanGrad.addColorStop(0.5, 'rgba(18, 127, 144, 0.15)');
      scanGrad.addColorStop(1, 'transparent');

      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, 0, width, height);

      // Text prompt
      ctx.fillStyle = colors.ink3;
      ctx.font = '8px var(--font-mono)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SELECT AN INPUT TO INITIALIZE ANALYZER', width / 2, midline);
      ctx.textAlign = 'left';
    }
  }, active);

  return (
    <div
      className={`relative h-20 overflow-hidden rounded-xl border bg-inset transition-colors duration-500 sm:h-24 lg:h-28 ${
        isRecording ? 'border-rec/30' : 'border-line'
      }`}
    >
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden />

      <span className="pointer-events-none absolute bottom-2 left-3 font-mono text-[8px] tracking-[0.2em] uppercase text-ink-3">
        {isRecording ? 'Capturing' : active ? 'Monitoring' : 'Standby'}
      </span>
      <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[8px] tracking-[0.2em] uppercase text-ink-3">
        System OK
      </span>
    </div>
  );
}
