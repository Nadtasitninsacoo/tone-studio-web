'use client';

import { useEffect, useRef } from 'react';

interface DspPhaseGraphProps {
  mainDelay: number; // in ms (0 - 10)
  subDelay: number;  // in ms (0 - 10)
  mainPhase: number; // in degrees (0 - 360)
  subPhase: number;  // in degrees (0 - 360)
  mainInverted: boolean;
  subInverted: boolean;
  hudColor?: string;
}

const F_MIN = 20;
const F_MAX = 20000;

export function DspPhaseGraph({
  mainDelay,
  subDelay,
  mainPhase,
  subPhase,
  mainInverted,
  subInverted,
  hudColor = 'cyan',
}: DspPhaseGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Map frequency to log X coordinate
  const getX = (freq: number, width: number) => {
    const logMin = Math.log10(F_MIN);
    const logMax = Math.log10(F_MAX);
    const logFreq = Math.log10(Math.max(F_MIN, Math.min(F_MAX, freq)));
    return ((logFreq - logMin) / (logMax - logMin)) * width;
  };

  // Map X back to frequency
  const getFreq = (x: number, width: number) => {
    const logMin = Math.log10(F_MIN);
    const logMax = Math.log10(F_MAX);
    const logFreq = logMin + (x / width) * (logMax - logMin);
    return Math.pow(10, logFreq);
  };

  // Map phase angle (+180 to -180) to Y coordinate
  const getY = (phaseDeg: number, height: number) => {
    return ((180 - phaseDeg) / 360) * height;
  };

  // Wrap phase angle to [-180, 180] degrees
  const wrapPhase = (deg: number) => {
    let wrapped = (deg + 180) % 360;
    if (wrapped < 0) wrapped += 360;
    return wrapped - 180;
  };

  // Calculate phase at frequency f
  const calcPhase = (f: number, delayMs: number, phaseShiftDeg: number, isInverted: boolean) => {
    const delaySec = delayMs / 1000;
    // Phase shift from delay: -360 * f * delaySec
    const delayPhaseShift = -360 * f * delaySec;
    const polarityPhaseShift = isInverted ? 180 : 0;
    
    const totalPhase = delayPhaseShift + phaseShiftDeg + polarityPhaseShift;
    return wrapPhase(totalPhase);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      // 1. Draw Grid
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      ctx.font = '8px monospace';
      ctx.fillStyle = '#71717a';

      // Logarithmic vertical frequency grids
      const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      ticks.forEach((t) => {
        const x = getX(t, width);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        if (t === 100 || t === 1000 || t === 10000) {
          const label = t >= 1000 ? `${t / 1000}kHz` : `${t}Hz`;
          ctx.fillText(label, x + 2, height - 4);
        }
      });

      // Horizontal Phase degree grids
      const phaseTicks = [180, 90, 0, -90, -180];
      phaseTicks.forEach((deg) => {
        const y = getY(deg, height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        const label = deg > 0 ? `+${deg}°` : `${deg}°`;
        ctx.fillText(label, 4, y - 2);
      });

      // 2. Draw Main Phase Curve (Cyan / Active HUE)
      const activeColor = hudColor === 'green' ? '#22c55e' : 
                          hudColor === 'cyan' ? '#06b6d4' : 
                          hudColor === 'violet' ? '#8b5cf6' : 
                          hudColor === 'amber' ? '#f59e0b' : '#ec4899';

      ctx.beginPath();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 2;
      ctx.shadowColor = activeColor;
      ctx.shadowBlur = 4;

      let lastMainY = 0;
      for (let x = 0; x < width; x++) {
        const freq = getFreq(x, width);
        const phase = calcPhase(freq, mainDelay, mainPhase, mainInverted);
        const y = getY(phase, height);

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          // Detect phase wrap wrap-around jump and lift pen
          if (Math.abs(y - lastMainY) > height * 0.8) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        lastMainY = y;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 3. Draw Sub Phase Curve (Magenta / Fuchsia)
      ctx.beginPath();
      ctx.strokeStyle = '#d946ef';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#d946ef';
      ctx.shadowBlur = 4;

      let lastSubY = 0;
      for (let x = 0; x < width; x++) {
        const freq = getFreq(x, width);
        const phase = calcPhase(freq, subDelay, subPhase, subInverted);
        const y = getY(phase, height);

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          // Detect phase wrap wrap-around jump and lift pen
          if (Math.abs(y - lastSubY) > height * 0.8) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        lastSubY = y;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    draw();
    window.addEventListener('resize', draw);

    return () => {
      window.removeEventListener('resize', draw);
    };
  }, [mainDelay, subDelay, mainPhase, subPhase, mainInverted, subInverted, hudColor]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] font-bold tracking-wider text-ink-3 uppercase">
          PHASE ALIGNMENT GRAPH (Degrees vs Frequency)
        </span>
        <div className="flex gap-3 text-[8px] font-mono uppercase font-bold">
          <span style={{ color: hudColor === 'green' ? '#22c55e' : 
                                  hudColor === 'cyan' ? '#06b6d4' : 
                                  hudColor === 'violet' ? '#8b5cf6' : 
                                  hudColor === 'amber' ? '#f59e0b' : '#ec4899' }}>● MAIN</span>
          <span className="text-[#d946ef]">● SUB</span>
        </div>
      </div>

      <div 
        ref={containerRef} 
        className="relative h-40 w-full rounded-xl border border-line bg-inset/70 overflow-hidden"
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      </div>
    </div>
  );
}
