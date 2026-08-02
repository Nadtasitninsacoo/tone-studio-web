'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { AudioWaveform, Sliders, Zap, ArrowLeft } from 'lucide-react';

import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { useMixerStudio } from '@/components/providers/StudioProviders';
import {
  subscribeAmp,
  getRigSnapshot,
  getServerRigSnapshot,
  setBassSettings,
} from '@/lib/ampStore';
import { useHudColor } from '@/hooks/useHudColor';
import { setHudColor as setHudColorStore, type HudColor } from '@/lib/hudColor';
// Instrument type removed as unused

import { dbToFaderPosition, faderPositionToDb } from '@/lib/mixer';

import { MixerChannelStrip } from './MixerChannelStrip';
import { MixerSourceRow } from './MixerSourceRow';
import { MixerTransport } from './MixerTransport';
import { DspCrossoverGraph } from './DspCrossoverGraph';
import { DspPhaseGraph } from './DspPhaseGraph';

// Standard 8 channels
const CHANNEL_NAMES = ['IN 1', 'V-TONE', 'DRUMS', 'BREAK', 'FX 1', 'FX 2', 'IN 7', 'IN 8'];

// CHANNEL_TO_INSTRUMENT removed as unused

const HUD_COLORS = {
  green: { text: 'text-green', border: 'border-green/45', bg: 'bg-green/12', led: 'bg-green' },
  cyan: { text: 'text-cyan', border: 'border-cyan/45', bg: 'bg-cyan/12', led: 'bg-cyan' },
  violet: { text: 'text-violet', border: 'border-violet/45', bg: 'bg-violet/12', led: 'bg-violet' },
  amber: { text: 'text-amber', border: 'border-amber/45', bg: 'bg-amber/12', led: 'bg-amber' },
  pink: { text: 'text-pink', border: 'border-pink/45', bg: 'bg-pink/12', led: 'bg-pink' }
};

type HudColorType = keyof typeof HUD_COLORS;

export function MixerWorkspace() {
  const router = useRouter();
  // recorder unused

  /**
   * The desk itself. Every strip on this page is one of its channels.
   *
   * It lives in `StudioProviders`, above the router, so leaving this page does not
   * close the AudioContext, drop the takes loaded onto channels or release the input —
   * the mix is a session, not a page. See `hooks/useMixer.ts`.
   */
  const mixer = useMixerStudio();
  const channels = mixer.state.channels;

  /**
   * The rig, for the DSP panel's crossover reading.
   *
   * The third argument is not optional here: this route is prerendered like every
   * other one, and React throws "Missing getServerSnapshot, which is required for
   * server-rendered content" during `next build` without it — the build fails on
   * this page rather than degrading. The store exports one per value for exactly
   * this reason; see `lib/ampStore.ts`.
   */
  const rigStore = useSyncExternalStore(subscribeAmp, getRigSnapshot, getServerRigSnapshot);

  // Selected tab in the right panel: 'mixer' | 'dsp'
  const [activeTab, setActiveTab] = useState<'mixer' | 'dsp'>('dsp');

  // Custom HUD color theme from external store
  const hudColor = useHudColor();

  // DSP parameters
  const crossoverHz = rigStore.bass.crossoverHz;
  /** The mixer's own master fader, as the 0–100 position this console draws. */
  const masterVolume = dbToFaderPosition(mixer.state.master.gainDb);
  
  // Local state for visualization only
  const [mainDelay] = useState<number>(0.15); // ms
  const [subDelay] = useState<number>(0.06);  // ms
  const [mainPhase] = useState<number>(0);     // deg
  const [subPhase] = useState<number>(180);   // deg
  const [mainInverted] = useState<boolean>(false);
  const [subInverted] = useState<boolean>(true);

  // State for Mixer Routing matrix (visualization only)
  const [routing] = useState<boolean[][]>([
    [true, false, false, true],  // IN 1 -> Master, Aux
    [true, true, false, false],  // V-TONE -> Master, FX 1
    [true, false, true, false],  // DRUMS -> Master, FX 2
    [true, false, false, false], // BREAK -> Master
    [false, true, false, true],  // FX 1 -> FX 1, Aux
    [false, false, true, true],  // FX 2 -> FX 2, Aux
    [true, false, false, false], // IN 7 -> Master
    [true, false, false, false], // IN 8 -> Master
  ]);

  // DOM references cache for 60fps master VU meters rendering
  const masterSegmentsRef = useRef<HTMLDivElement[][]>([]);

  const changeColor = (color: HudColorType) => {
    setHudColorStore(color as HudColor);
  };

  const cycleColor = () => {
    const keys = Object.keys(HUD_COLORS) as HudColorType[];
    const nextIdx = (keys.indexOf(hudColor) + 1) % keys.length;
    changeColor(keys[nextIdx]);
  };

  // Cache master segment elements once elements render
  useEffect(() => {
    const masterCache: HTMLDivElement[][] = [];
    for (let m = 0; m < 2; m++) {
      const mSegments: HTMLDivElement[] = [];
      for (let s = 0; s < 14; s++) {
        const el = document.getElementById(`vu-master-${m}-seg-${s}`) as HTMLDivElement;
        if (el) mSegments.push(el);
      }
      masterCache.push(mSegments);
    }
    masterSegmentsRef.current = masterCache;
  }, [activeTab]);

  /**
   * Paint master meter from the engine's L/R analysers.
   */
  useAnimationFrame(() => {
    const masterPeakL = mixer.getMeter('master-L').peak;
    const masterPeakR = mixer.getMeter('master-R').peak;
    const peaks = [masterPeakL, masterPeakR];

    for (let m = 0; m < 2; m++) {
      const segments = masterSegmentsRef.current[m];
      if (!segments) continue;
      const peak = peaks[m];
      for (let s = 0; s < 14; s += 1) {
        const el = segments[s];
        if (!el) continue;
        const isLit = peak >= s / 13 && peak > 0.01;
        if (isLit) {
          if (s >= 12) el.className = 'h-1.5 w-3 rounded-xs bg-rec shadow-[0_0_4px_#e01843]';
          else if (s >= 8) el.className = 'h-1.5 w-3 rounded-xs bg-amber shadow-[0_0_4px_#f5b544]';
          else el.className = 'h-1.5 w-3 rounded-xs bg-green shadow-[0_0_4px_#2af650]';
        } else {
          el.className = 'h-1.5 w-3 rounded-xs bg-[#151722]';
        }
      }
    }
  }, mixer.isLive);

  // Clear meters when mixer is not live
  useEffect(() => {
    if (!mixer.isLive) {
      for (const segments of [masterSegmentsRef.current[0], masterSegmentsRef.current[1]]) {
        if (!segments) continue;
        for (let s = 0; s < 14; s += 1) {
          const el = segments[s];
          if (el) el.className = 'h-1.5 w-3 rounded-xs bg-[#151722]';
        }
      }
    }
  }, [mixer.isLive]);

  /**
   * Every strip control, straight into the engine.
   */
  function handleParamChange(channelIdx: number, param: 'mute', value: boolean): void;
  function handleParamChange(channelIdx: number, param: 'gain' | 'pan' | 'volume', value: number): void;
  function handleParamChange(
    channelIdx: number,
    param: 'gain' | 'pan' | 'volume' | 'mute',
    value: number | boolean,
  ) {
    const channel = channels[channelIdx];
    if (!channel) return;

    if (param === 'mute') {
      if (Boolean(value) !== channel.muted) mixer.toggleChannelMute(channel.id);
      return;
    }
    if (param === 'gain') {
      mixer.setChannelTrim(channel.id, Number(value));
      return;
    }
    if (param === 'pan') {
      mixer.setChannelPan(channel.id, Number(value) / 100);
      return;
    }
    mixer.setChannelGain(channel.id, faderPositionToDb(Number(value)));
  }

  const style = HUD_COLORS[hudColor];
  const activeColorCode = hudColor === 'green' ? '#22c55e' : 
                          hudColor === 'cyan' ? '#06b6d4' : 
                          hudColor === 'violet' ? '#8b5cf6' : 
                          hudColor === 'amber' ? '#f59e0b' : '#ec4899';

  return (
    <div className="flex min-h-full flex-col select-none">
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-3 py-3.5 sm:px-5 sm:py-4">
        
        {/* Header Cockpit Title Bar */}
        <div className="flex animate-rise-in items-center justify-between rounded-xl border border-line bg-panel py-3 shadow-panel pl-14 pr-4 lg:px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/')}
              title="Return to Recorder Dashboard"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-raised hover:border-cyan/50 text-ink active:scale-95 transition-all"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            
            <div className="flex items-center gap-2 text-cyan">
              <AudioWaveform className="h-5 w-5 animate-pulse" />
              <h1 className="font-mono text-xs font-bold tracking-[0.24em] uppercase text-ink leading-none">
                NEURAL AUDIO PROCESSOR
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Color preset switcher */}
            <button
              type="button"
              onClick={cycleColor}
              title={`HUD color: ${hudColor}. Click to change theme`}
              className={`h-7 w-7 rounded-lg border border-line bg-raised hover:border-${hudColor}/65 flex items-center justify-center text-ink cursor-pointer transition-all active:scale-90`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${style.led} shadow-lg`} />
            </button>

            <span className="hidden sm:inline-flex font-mono text-[7px] tracking-wider text-ink-3 uppercase bg-inset px-2 py-1 rounded border border-line">
              v1.2 // WEB
            </span>
          </div>
        </div>

        {/* Console Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_390px] gap-4 items-stretch min-w-0">
          
          {/* LEFT BOX: Mixer Console Desk Strips */}
          <div className="flex flex-col rounded-xl border border-line bg-panel p-4 shadow-panel min-w-0">
            <div className="flex items-center justify-between border-b border-line pb-3.5 mb-4 w-full">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-ink-2" />
                <h2 className="font-mono text-xs font-bold tracking-wider text-ink uppercase">
                  Analog Console Channel Strips
                </h2>
              </div>
              <div className="flex gap-2">
                <span className="font-mono text-[7px] text-ink-3 uppercase leading-none border border-line bg-inset/45 px-1.5 py-0.5 rounded">
                  8 Channel In
                </span>
                <span className="font-mono text-[7px] text-ink-3 uppercase leading-none border border-line bg-inset/45 px-1.5 py-0.5 rounded">
                  Post-Fader Send
                </span>
              </div>
            </div>

            {/* Empty Desk Warning */}
            {channels.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 border border-dashed border-line rounded-lg text-ink-3 text-xs bg-inset/15 min-h-[300px]">
                No active mixer channels. Please refresh or initialize.
              </div>
            ) : channels.every((c) => c.source.kind === 'empty') ? (
              <div className="flex items-start gap-3 rounded-lg border border-rec/35 bg-rec/6 p-3 text-[10px] text-rec font-mono mb-4 leading-normal select-text">
                <Zap className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="font-mono text-[9px] font-bold tracking-[0.14em] uppercase">
                  no source
                </span>
                <p className="min-w-0 flex-1">
                  Every channel is empty, so the desk is silent. Press{' '}
                  <strong>NO SOURCE</strong> on a strip to take the live input, or pick a take
                  or a file in the row below the strips.
                </p>
              </div>
            ) : null}

            {/* Scrollable strips row */}
            <div className="flex gap-2 overflow-x-auto pb-2 justify-between w-full scrollbar-thin">
              {channels.map((channel, idx) => (
                <MixerChannelStrip
                  key={channel.id}
                  channelId={channel.id}
                  name={channel.name}
                  gain={channel.trimDb}
                  pan={channel.pan * 100}
                  volume={dbToFaderPosition(channel.gainDb)}
                  mute={channel.muted}
                  getMeter={mixer.getMeter}
                  isLive={mixer.isLive}
                  onParamChange={(param, value) => {
                    if (param === 'mute') {
                      handleParamChange(idx, param, value as boolean);
                    } else {
                      handleParamChange(idx, param, value as number);
                    }
                  }}
                  hudColor={hudColor}
                  source={channel.source.kind}
                  // A toggle, not a one-way switch: pressing LIVE IN again gives the
                  // channel back. Turning something on with no way to turn it off is not
                  // a control.
                  onTakeLive={() =>
                    channel.source.kind === 'live'
                      ? mixer.clearChannel(channel.id)
                      : mixer.takeLiveInput(channel.id)
                  }
                />
              ))}
            </div>

            {/* What each strip is playing. A fader can only change the level of
                something, so this is what makes the strips above mean anything. */}
            <div className="mt-3 border-t border-line pt-3">
              <MixerSourceRow />
            </div>
          </div>

          {/* RIGHT BOX: Tabbed DSP Panel & Master Fader */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] rounded-xl border border-line bg-panel p-4 shadow-panel items-stretch gap-6 sm:gap-0 min-w-0">
            
            {/* DSP panel (left column of the right box) */}
            <div className="flex flex-col min-w-0 pr-0 sm:pr-4">
              <div className="flex items-center justify-between border-b border-line pb-3 mb-4 w-full">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('mixer')}
                    className={`h-7 px-3 rounded-md font-mono text-[9px] font-bold uppercase tracking-wider transition-all ${
                      activeTab === 'mixer'
                        ? `border ${style.border} ${style.bg} ${style.text}`
                        : 'border border-transparent text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    ROUTING
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('dsp')}
                    className={`h-7 px-3 rounded-md font-mono text-[9px] font-bold uppercase tracking-wider transition-all ${
                      activeTab === 'dsp'
                        ? `border ${style.border} ${style.bg} ${style.text}`
                        : 'border border-transparent text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    DSP
                  </button>
                </div>
                <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-3">
                  {activeTab === 'dsp' ? 'CROSSOVER & PHASE' : 'MATRIX PATCHBOARD'}
                </span>
              </div>

              {/* Tab 1: DSP Tools */}
              {activeTab === 'dsp' ? (
                <div className="flex flex-col gap-4 flex-1 justify-between">
                  <DspCrossoverGraph
                    crossoverHz={crossoverHz}
                    onChange={(hz) => setBassSettings({ ...rigStore.bass, crossoverHz: hz })}
                    hudColor={hudColor}
                  />

                  <div className="flex flex-col gap-3.5 border-t border-line/45 pt-3.5">
                    <DspPhaseGraph
                      mainDelay={mainDelay}
                      subDelay={subDelay}
                      mainPhase={mainPhase}
                      subPhase={subPhase}
                      mainInverted={mainInverted}
                      subInverted={subInverted}
                      hudColor={hudColor}
                    />

                    {/* Simulation notice for Delay, Phase, and Polarity */}
                    <span className="font-mono text-[7.5px] text-amber border border-amber/35 bg-amber/5 px-2.5 py-1.5 rounded-lg leading-normal text-center block w-full uppercase tracking-wider">
                      * Delay, Phase, and Polarity controls are for visualization only.
                    </span>

                    {/* Phase Controls Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 mt-1 select-none">
                      {/* 1. Delay sliders */}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col opacity-55 cursor-not-allowed">
                          <div className="flex items-center justify-between font-mono text-[7px] text-ink-3 leading-none">
                            <span>DELAY: MAIN</span>
                            <span className="text-cyan font-bold">{mainDelay.toFixed(2)} ms</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={10}
                            step={0.01}
                            value={mainDelay}
                            disabled
                            className="w-full h-1 bg-black/60 rounded-full mt-1.5 outline-none cursor-not-allowed accent-cyan"
                          />
                        </div>

                        <div className="flex flex-col opacity-55 cursor-not-allowed">
                          <div className="flex items-center justify-between font-mono text-[7px] text-ink-3 leading-none">
                            <span>DELAY: SUB</span>
                            <span className="text-fuchsia-400 font-bold">{subDelay.toFixed(2)} ms</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={10}
                            step={0.01}
                            value={subDelay}
                            disabled
                            className="w-full h-1 bg-black/60 rounded-full mt-1.5 outline-none cursor-not-allowed accent-fuchsia-500"
                          />
                        </div>
                      </div>

                      {/* 2. Phase sliders */}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col opacity-55 cursor-not-allowed">
                          <div className="flex items-center justify-between font-mono text-[7px] text-ink-3 leading-none">
                            <span>PHASE: MAIN</span>
                            <span className="text-cyan font-bold">{mainPhase}°</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={360}
                            step={1}
                            value={mainPhase}
                            disabled
                            className="w-full h-1 bg-black/60 rounded-full mt-1.5 outline-none cursor-not-allowed accent-cyan"
                          />
                        </div>

                        <div className="flex flex-col opacity-55 cursor-not-allowed">
                          <div className="flex items-center justify-between font-mono text-[7px] text-ink-3 leading-none">
                            <span>PHASE: SUB</span>
                            <span className="text-fuchsia-400 font-bold">{subPhase}°</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={360}
                            step={1}
                            value={subPhase}
                            disabled
                            className="w-full h-1 bg-black/60 rounded-full mt-1.5 outline-none cursor-not-allowed accent-fuchsia-500"
                          />
                        </div>
                      </div>

                      {/* 3. Polarity switches */}
                      <div className="flex flex-row md:flex-col justify-between items-center md:items-start h-full py-2 md:py-0.5 pl-0 md:pl-2 border-t md:border-t-0 md:border-l border-line/45 select-none gap-2 md:gap-0">
                        <span className="font-mono text-[6px] tracking-wider text-ink-3 uppercase text-center block md:mb-1">
                          POLARITY
                        </span>
                        
                        <button
                          type="button"
                          disabled
                          className={`h-5 w-12 rounded border font-mono text-[7px] font-bold transition-all opacity-55 cursor-not-allowed ${
                            mainInverted
                              ? 'border-cyan/50 bg-cyan/15 text-cyan'
                              : 'border-line text-ink-3'
                          }`}
                        >
                          MAIN {mainInverted ? 'INV' : 'NOR'}
                        </button>
                        
                        <button
                          type="button"
                          disabled
                          className={`h-5 w-12 rounded border font-mono text-[7px] font-bold transition-all opacity-55 cursor-not-allowed ${
                            subInverted
                              ? 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-400'
                              : 'border-line text-ink-3'
                          }`}
                        >
                          SUB {subInverted ? 'INV' : 'NOR'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Tab 2: Routing matrix */
                <div className="flex flex-col justify-between flex-1 gap-4">
                  <div className="flex flex-col gap-2 rounded-xl border border-line bg-inset/30 p-3 flex-grow">
                    <span className="font-mono text-[8px] font-bold tracking-wider text-ink-3 uppercase border-b border-line pb-1.5 block mb-2">
                      PATCH MATRIX ROUTING MAP
                    </span>

                    {/* Routing Grid */}
                    <div className="grid grid-cols-[2.5rem_1fr] gap-x-2 gap-y-1.5 items-center select-none">
                      {/* Destination Header Row */}
                      <div />
                      <div className="grid grid-cols-4 gap-1 text-center font-mono text-[7px] text-ink-3 uppercase">
                        <span>MASTER</span>
                        <span>FX BUS 1</span>
                        <span>FX BUS 2</span>
                        <span>AUX MIX</span>
                      </div>

                      {/* Channel Rows */}
                      {CHANNEL_NAMES.map((name, chIdx) => (
                        <React.Fragment key={`row-${name}`}>
                          <span className="font-mono text-[8px] font-bold text-ink-2 truncate">
                            {name}
                          </span>
                          <div className="grid grid-cols-4 gap-1">
                            {Array.from({ length: 4 }).map((_, destIdx) => {
                              const isActive = routing[chIdx][destIdx];
                              return (
                                <button
                                  key={`route-${chIdx}-${destIdx}`}
                                  type="button"
                                  disabled
                                  className={`h-6.5 rounded flex items-center justify-center border transition-all opacity-70 cursor-not-allowed ${
                                    isActive
                                      ? `border-${hudColor}/60 bg-${hudColor}/12 text-${hudColor}`
                                      : 'border-line text-ink-3'
                                  }`}
                                >
                                  {isActive ? (
                                    <span 
                                      className="h-1.5 w-1.5 rounded-full"
                                      style={{
                                        backgroundColor: activeColorCode,
                                        boxShadow: `0 0 6px ${activeColorCode}`
                                      }}
                                    />
                                  ) : (
                                    <span className="h-1 w-1 rounded-full bg-ink-3/20" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    
                    {/* Simulation notice for Patch Matrix */}
                    <span className="font-mono text-[7.5px] text-amber border border-amber/35 bg-amber/5 px-2.5 py-1.5 rounded-lg leading-normal text-center block w-full uppercase tracking-wider mt-3">
                      * Matrix routing is for visual reference only.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* FAR RIGHT MASTER SECTION PANEL */}
            <div className="flex flex-row sm:flex-col items-center justify-between sm:justify-start gap-4 sm:gap-0 sm:pl-4 select-none w-full sm:w-16 pt-4 sm:pt-0 border-t sm:border-t-0 border-line/45">
              <span className="font-mono text-[6px] tracking-widest text-ink-3 uppercase leading-none select-none text-left sm:text-center block mb-0 sm:mb-3">
                MASTER<br className="hidden sm:block"/> SECTION
              </span>

              {/* Master LED VU Meters L/R side-by-side */}
              <div className="flex gap-1.5 bg-black/60 p-1.5 rounded-lg border border-line/45 mb-0 sm:mb-4 select-none h-14 sm:h-36">
                
                {/* Left Master Meter */}
                <div className="flex flex-row sm:flex-col gap-0.5 sm:gap-0.75 h-full items-center justify-center">
                  {Array.from({ length: 14 }).map((_, idx) => (
                    <div 
                      key={`left-seg-${idx}`} 
                      id={`vu-master-0-seg-${13 - idx}`} 
                      className="h-1 sm:h-1.5 w-2 sm:w-3 rounded-xs bg-[#151722]"
                    />
                  ))}
                  <span className="hidden sm:block font-mono text-[5px] text-ink-3 mt-1 scale-90">L</span>
                </div>

                {/* Right Master Meter */}
                <div className="flex flex-row sm:flex-col gap-0.5 sm:gap-0.75 h-full items-center justify-center">
                  {Array.from({ length: 14 }).map((_, idx) => (
                    <div 
                      key={`right-seg-${idx}`} 
                      id={`vu-master-1-seg-${13 - idx}`} 
                      className="h-1 sm:h-1.5 w-2 sm:w-3 rounded-xs bg-[#151722]"
                    />
                  ))}
                  <span className="hidden sm:block font-mono text-[5px] text-ink-3 mt-1 scale-90">R</span>
                </div>

              </div>

              {/* Master Volume Fader Track */}
              <div className="relative flex flex-col items-center h-28 sm:h-40 w-6 mb-0 sm:mb-2">
                <div className="absolute inset-y-0 w-1 rounded-full bg-black/60 border border-line" />
                <div 
                  className="absolute bottom-0 w-0.5 rounded-full transition-all duration-75"
                  style={{
                    height: `${masterVolume}%`,
                    backgroundColor: activeColorCode,
                    boxShadow: `0 0 8px ${activeColorCode}`
                  }}
                />

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={masterVolume}
                  onChange={(e) => mixer.setMasterGainDb(faderPositionToDb(Number(e.target.value)))}
                  className="absolute h-full w-full opacity-0 cursor-pointer pointer-events-auto z-20"
                  style={{
                    writingMode: 'vertical-lr',
                    direction: 'rtl',
                  }}
                />

                <div 
                  className="absolute w-5.5 h-3 rounded-sm border border-line-strong bg-raised shadow flex items-center justify-center pointer-events-none transition-all duration-75 z-10"
                  style={{
                    bottom: `calc(${masterVolume}% - 6px)`
                  }}
                >
                  <div className="w-3.5 h-0.5 rounded-full bg-ink-3 opacity-90" />
                </div>
              </div>

              <div className="flex flex-col items-end sm:items-center justify-center shrink-0">
                <span className="font-mono text-[7px] text-ink-3 uppercase mt-1 leading-none">OUTPUT</span>
                <span className="font-mono text-[8px] text-cyan font-bold leading-none mt-0.5">{masterVolume.toFixed(0)}%</span>
              </div>
            </div>

          </div>
          
        </div>
      </main>
      
      {/* Footer controls layout.
          `py-3` alone left the content flush against both page edges — the border this
          strip is drawn with ran straight through it. The inner box repeats `<main>`'s own
          container (`max-w-[1600px]`, `px-3 sm:px-5`) so the transport lines up with the
          console panels above it instead of sitting in its own margin. `min-w-0` is what
          lets its children shrink rather than stretch the row past the viewport. */}
      <div className="mt-auto border-t border-line bg-panel/30 py-3.5 shadow-panel">
        <div className="mx-auto w-full min-w-0 max-w-[1600px] px-3 sm:px-5">
          <MixerTransport />
        </div>
      </div>
    </div>
  );
}
