'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useHudColor } from '@/hooks/useHudColor';
import { setHudColor as setHudColorStore, type HudColor } from '@/lib/hudColor';
import { Pause, Play, RefreshCw, Square, Trash2 } from 'lucide-react';

import type { RecorderStatus } from '@/types/recorder';

interface TransportControlsProps {
  status: RecorderStatus;
  /** False until an input device is open — the transport stays locked. */
  canRecord: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onDiscard: () => void;
}

const HUD_COLORS = {
  green: {
    text: 'text-green',
    border: 'border-green/45',
    borderActive: 'border-green/80',
    bg: 'bg-green/12',
    glow: 'shadow-[0_0_15px_rgba(34,197,94,0.25)]',
    led: 'bg-green',
    rawGlow: 'rgba(34,197,94,0.3)',
    borderColor: 'rgba(34,197,94,0.4)',
    accent: 'green'
  },
  cyan: {
    text: 'text-cyan',
    border: 'border-cyan/45',
    borderActive: 'border-cyan/80',
    bg: 'bg-cyan/12',
    glow: 'shadow-[0_0_15px_rgba(18,127,144,0.25)]',
    led: 'bg-cyan',
    rawGlow: 'rgba(18,127,144,0.3)',
    borderColor: 'rgba(18,127,144,0.4)',
    accent: 'cyan'
  },
  violet: {
    text: 'text-violet',
    border: 'border-violet/45',
    borderActive: 'border-violet/80',
    bg: 'bg-violet/12',
    glow: 'shadow-[0_0_15px_rgba(122,24,248,0.25)]',
    led: 'bg-violet',
    rawGlow: 'rgba(122,24,248,0.3)',
    borderColor: 'rgba(122,24,248,0.4)',
    accent: 'violet'
  },
  amber: {
    text: 'text-amber',
    border: 'border-amber/45',
    borderActive: 'border-amber/80',
    bg: 'bg-amber/12',
    glow: 'shadow-[0_0_15px_rgba(245,158,11,0.25)]',
    led: 'bg-amber',
    rawGlow: 'rgba(245,158,11,0.3)',
    borderColor: 'rgba(245,158,11,0.4)',
    accent: 'amber'
  },
  pink: {
    text: 'text-pink',
    border: 'border-pink/45',
    borderActive: 'border-pink/80',
    bg: 'bg-pink/12',
    glow: 'shadow-[0_0_15px_rgba(236,72,153,0.25)]',
    led: 'bg-pink',
    rawGlow: 'rgba(236,72,153,0.3)',
    borderColor: 'rgba(236,72,153,0.4)',
    accent: 'pink'
  }
};

type HudColorType = keyof typeof HUD_COLORS;

export function TransportControls({
  status,
  canRecord,
  onStart,
  onStop,
  onPause,
  onResume,
  onDiscard,
}: TransportControlsProps) {
  const router = useRouter();
  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isActive = isRecording || isPaused;

  // Screen state inside the mini console display: 'welcome' | 'menu' | 'transport'
  const [screenState, setScreenState] = useState<'welcome' | 'menu' | 'transport'>('welcome');

  // Custom HUD color from external store
  const hudColor = useHudColor();

  const changeColor = (color: HudColorType) => {
    setHudColorStore(color as HudColor);
  };

  const cycleColor = () => {
    const keys = Object.keys(HUD_COLORS) as HudColorType[];
    const nextIdx = (keys.indexOf(hudColor) + 1) % keys.length;
    changeColor(keys[nextIdx]);
  };

  const style = HUD_COLORS[hudColor];

  // Auto-switch screenState when recording/pausing starts externally (like via shortcut keys)
  useEffect(() => {
    if (isActive) {
      setScreenState('transport');
    }
  }, [isActive]);

  // Standby screen when disarmed (no device connected or status idle/error)
  if (status === 'idle' || status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex h-28 w-64 flex-col items-center justify-center overflow-hidden rounded-xl border border-line bg-inset p-3 shadow-md">
          {/* Animated scanning bar */}
          <div className="absolute inset-y-0 w-1/3 animate-scan bg-linear-to-r from-transparent via-cyan/8 to-transparent opacity-60 pointer-events-none" />
          
          {/* Glowing dot & Standby text */}
          <div className="flex items-center gap-2 text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan/50 animate-ping" />
            <span className="font-mono text-[9px] tracking-[0.24em] uppercase text-ink-3">SYSTEM STANDBY</span>
          </div>
          <p className="mt-2 text-center font-mono text-[8px] text-ink-3 uppercase tracking-wider">
            Choose input device to mount console
          </p>
        </div>
        <p className="hidden text-center font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3/50 sm:block">
          Transport Offline
        </p>
      </div>
    );
  }

  // Loading screen when arming
  if (status === 'arming') {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex h-28 w-64 flex-col items-center justify-center overflow-hidden rounded-xl border border-line bg-inset p-3">
          <RefreshCw className="h-5 w-5 text-cyan animate-spin" />
          <span className="mt-2.5 font-mono text-[9px] tracking-[0.2em] uppercase text-cyan animate-pulse">
            BOOTING CORE...
          </span>
        </div>
        <p className="hidden text-center font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3/50 sm:block">
          Syncing Graph
        </p>
      </div>
    );
  }

  // State 1: Welcome / Boot Screen
  if (screenState === 'welcome') {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className={`relative flex h-28 w-64 flex-col items-center justify-between rounded-xl border border-line bg-inset/90 p-3 shadow-inner`}>
          {/* Grid background */}
          <div 
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(var(--c-line) 1px, transparent 0)`,
              backgroundSize: '10px 10px'
            }}
          />

          <div className="flex w-full items-center justify-between z-10">
            <span className={`font-mono text-[7px] tracking-[0.15em] uppercase text-ink-3`}>
              STUDIO HUD // v1.04
            </span>
            <span className={`h-1.5 w-1.5 rounded-full ${style.led} animate-pulse`} />
          </div>

          <div className="flex flex-col items-center z-10 my-0.5">
            <button
              type="button"
              onClick={() => setScreenState('menu')}
              className={`flex h-11 px-6 items-center justify-center rounded-lg border-2 ${style.border} ${style.bg} ${style.text} font-mono text-[11px] font-bold uppercase tracking-[0.2em] transition-all duration-300 hover:${style.borderActive} hover:${style.glow} active:scale-95`}
            >
              START
            </button>
            <span className="mt-1.5 font-mono text-[7px] text-ink-3 uppercase tracking-wider">
              CORE SYSTEM READY
            </span>
          </div>

          <div className="flex w-full justify-between items-center z-10">
            <span className="font-mono text-[6px] tracking-wider text-ink-3 uppercase">
              SYNC: INT
            </span>
            <button
              type="button"
              onClick={cycleColor}
              className={`font-mono text-[7px] tracking-[0.1em] font-semibold ${style.text} uppercase hover:underline`}
            >
              HUE: {hudColor}
            </button>
          </div>
        </div>
        <p className="hidden text-center font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3/50 sm:block">
          Console Standby
        </p>
      </div>
    );
  }

  // State 2: Mode Selector Menu
  if (screenState === 'menu') {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex h-28 w-64 flex-col justify-between rounded-xl border border-line bg-inset/90 p-3 shadow-inner">
          <div className="flex items-center justify-between z-10">
            <span className="font-mono text-[7px] tracking-[0.15em] uppercase text-ink-3">
              SELECT TASK
            </span>
            <button
              type="button"
              onClick={cycleColor}
              className={`font-mono text-[7px] font-semibold ${style.text} uppercase hover:underline`}
            >
              HUE: {hudColor}
            </button>
          </div>

          {/* Mode Selector Buttons */}
          <div className="flex flex-col gap-1.5 z-10 w-full px-1">
            <button
              type="button"
              onClick={() => setScreenState('transport')}
              className={`flex h-7 items-center justify-between rounded-md border ${style.border} px-3 text-left font-mono text-[9px] font-bold uppercase tracking-wider text-ink-2 transition-all duration-200 hover:${style.borderActive} hover:${style.text} hover:${style.bg}`}
            >
              <span>▲ RECORD WET MIX</span>
              <span className="text-[7px] opacity-60">READY</span>
            </button>

            <button
              type="button"
              onClick={() => router.push('/amp')}
              className={`flex h-7 items-center justify-between rounded-md border border-line px-3 text-left font-mono text-[9px] font-bold uppercase tracking-wider text-ink-2 transition-all duration-200 hover:border-cyan/50 hover:text-cyan hover:bg-cyan/10`}
            >
              <span>▼ ADJUST AMP TONE</span>
              <span className="text-[7px] opacity-60">AMP ENGINE</span>
            </button>
          </div>

          <div className="flex justify-between items-center z-10">
            <button
              type="button"
              onClick={() => setScreenState('welcome')}
              className="font-mono text-[7px] tracking-wider text-ink-3 uppercase hover:text-ink-2 hover:underline"
            >
              ■ SHUTDOWN
            </button>
            <span className="font-mono text-[6px] tracking-wider text-ink-3 uppercase">
              STATUS: SELECT
            </span>
          </div>
        </div>
        <p className="hidden text-center font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3/50 sm:block">
          Select Operation
        </p>
      </div>
    );
  }

  // State 3: Active Transport Controls
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Main Glass Screen for Armed Controls */}
      <div className="relative flex h-28 w-64 items-center justify-center overflow-hidden rounded-xl border border-line bg-inset/90 p-2 shadow-inner">
        
        {/* Subtle grid mesh background */}
        <div 
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(var(--c-line) 1px, transparent 0)`,
            backgroundSize: '12px 12px'
          }}
        />

        {/* --- PAUSE / RESUME (warps from center to left) ------------------ */}
        <button
          type="button"
          onClick={isPaused ? onResume : onPause}
          disabled={!isActive}
          aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
          title={isPaused ? 'Resume (Space)' : 'Pause (Space)'}
          style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          className={`absolute left-5 z-10 flex h-13 w-13 touch-manipulation items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-500 active:scale-95 disabled:pointer-events-none ${
            isActive
              ? `translate-x-0 scale-100 opacity-100 border-${hudColor}/50 bg-${hudColor}/12 text-${hudColor} shadow-[0_0_12px_${style.rawGlow}]`
              : 'translate-x-[4.5rem] scale-0 opacity-0 border-transparent text-ink-3'
          }`}
        >
          {isPaused ? (
            <Play aria-hidden className="h-5.5 w-5.5 translate-x-0.5 fill-current" />
          ) : (
            <Pause aria-hidden className="h-5.5 w-5.5 fill-current" />
          )}
        </button>

        {/* --- MAIN RECORD/STOP CORE (visual anchor in the center) --------- */}
        <div className="relative z-20 flex h-22 w-22 items-center justify-center">
          
          {/* Rotating high-tech dashed outer border ring */}
          <div className={`absolute inset-0 rounded-full border border-dashed transition-colors duration-500 animate-[spin_12s_linear_infinite] ${
            isActive ? 'border-rec/50' : `border-${hudColor}/35`
          }`} />

          {/* Record / Stop Button itself */}
          <button
            type="button"
            onClick={isActive ? onStop : onStart}
            disabled={!canRecord && !isActive}
            aria-label={isActive ? 'Stop recording' : 'Start recording'}
            title={isActive ? 'Stop recording (S)' : 'Start recording (R)'}
            className={`group flex h-18 w-18 touch-manipulation items-center justify-center rounded-full border-2 transition-all duration-300 active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${
              isActive
                ? 'animate-rec-pulse border-rec bg-rec/12 text-rec shadow-[0_0_15px_rgba(224,24,67,0.3)]'
                : `border-${hudColor}/45 bg-black/30 text-${hudColor} hover:border-${hudColor}/80 hover:shadow-[0_0_15px_rgba(var(--c-${hudColor}-rgb),0.2)]`
            }`}
          >
            {/* Expansional ripple ring while active */}
            {isRecording ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 animate-rec-ring rounded-full border border-rec"
              />
            ) : null}

            {/* Segment Rotary Ring Graphics */}
            <svg 
              className={`absolute inset-1.5 w-[calc(100%-12px)] h-[calc(100%-12px)] transition-transform duration-300 ${
                isActive ? 'animate-[spin_16s_linear_infinite]' : 'animate-[spin_32s_linear_infinite] group-hover:scale-105'
              }`}
              viewBox="0 0 64 64"
            >
              {/* Segmented outer ring */}
              <circle
                cx="32"
                cy="32"
                r="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 2.5"
                className="opacity-75 transition-colors duration-300"
              />
              {/* Inner reference ring */}
              <circle
                cx="32"
                cy="32"
                r="21"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.75"
                className="opacity-35 transition-colors duration-300"
              />
            </svg>

            {/* Center Status Core */}
            {isActive ? (
              <Square
                aria-hidden
                className="h-4.5 w-4.5 fill-rec text-rec drop-shadow-[0_0_6px_rgba(224,24,67,0.55)] z-10"
              />
            ) : (
              <div 
                className="h-4.5 w-4.5 rounded-full transition-transform duration-300 ease-spring group-hover:scale-115 z-10"
                style={{
                  backgroundColor: `var(--color-${hudColor})`,
                  boxShadow: `0 0 12px var(--color-${hudColor})`
                }}
              />
            )}
          </button>
        </div>

        {/* --- DISCARD (warps from center to right) ----------------------- */}
        <button
          type="button"
          onClick={onDiscard}
          disabled={!isActive}
          aria-label="Discard current recording"
          title="Discard take without saving"
          style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          className={`absolute right-5 z-10 flex h-13 w-13 touch-manipulation items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-500 active:scale-95 disabled:pointer-events-none ${
            isActive
              ? 'translate-x-0 scale-100 opacity-100 border-rec/40 bg-rec/10 text-ink-2 hover:border-rec/60 hover:text-rec hover:bg-rec/15 shadow-[0_0_12px_rgba(224,24,67,0.15)]'
              : 'translate-x-[-4.5rem] scale-0 opacity-0 border-transparent text-ink-3'
          }`}
        >
          <Trash2 aria-hidden className="h-5 w-5" />
        </button>

        {/* --- BACK TO MENU (Only visible when not recording) --------------- */}
        {!isActive ? (
          <button
            type="button"
            onClick={() => setScreenState('menu')}
            className={`absolute bottom-1 right-2 font-mono text-[7px] tracking-wider uppercase text-ink-3 hover:${style.text} transition-colors`}
          >
            ◀ MENU
          </button>
        ) : null}
      </div>

      {/* Keyboard hints */}
      <p className="hidden text-center font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3 sm:block">
        <Key>R</Key> rec · <Key>Space</Key> pause · <Key>S</Key> stop
      </p>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 text-ink-2 font-mono text-[9px]">{children}</kbd>
  );
}
