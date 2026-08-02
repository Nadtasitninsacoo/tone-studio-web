'use client';

import { AudioWaveform } from 'lucide-react';
import type { RefObject } from 'react';

import { Chip } from '@/components/ui/Panel';
import { formatChannels, formatSampleRate } from '@/lib/format';
import type { DevicePermission, InputDevice, RecorderStatus, StreamFormat, MeterSnapshot } from '@/types/recorder';

import { DeviceSelect } from './DeviceSelect';
import { StatusBadge } from './StatusBadge';
import { LevelMeter } from './LevelMeter';
import { usePressAndHold } from '@/hooks/usePressAndHold';
import { MiniSlider } from '@/components/ui/Controls';

interface HeaderBarProps {
  projectName: string;
  status: RecorderStatus;
  format: StreamFormat | null;
  devices: InputDevice[];
  activeDeviceId: string | null;
  permission: DevicePermission;
  isBusy: boolean;
  onSelectDevice: (device: InputDevice) => void;
  onRefreshDevices: () => void;
  onRequestAccess: () => void;
  meterRef: RefObject<MeterSnapshot>;
  channels: number;
  masterVolume: number;
  onChangeMasterVolume: (value: number) => void;
  isMonitoring: boolean;
}

/**
 * HeaderBar — sticky top chrome: identity, input routing, status and theme.
 *
 * Two rows on phones (brand + status, then the full-width device picker) and a
 * single row from `md` up. Device selection deliberately lives only here, so
 * there is one unambiguous answer to "where is my signal coming from".
 */
export function HeaderBar({
  projectName,
  status,
  format,
  devices,
  activeDeviceId,
  permission,
  isBusy,
  onSelectDevice,
  onRefreshDevices,
  onRequestAccess,
  meterRef,
  channels,
  masterVolume,
  onChangeMasterVolume,
  isMonitoring,
}: HeaderBarProps) {
  const isRecording = status === 'recording';

  const masterDecHandlers = usePressAndHold(() => {
    onChangeMasterVolume(Math.max(0, masterVolume - 0.01));
  });

  const masterIncHandlers = usePressAndHold(() => {
    onChangeMasterVolume(Math.min(1.5, masterVolume + 0.01));
  });

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base">
      {/* Full-width recording tell — visible even when the page is scrolled. */}
      {isRecording ? (
        <span aria-hidden className="tape-strip absolute inset-x-0 top-0 h-0.5 animate-tape" />
      ) : null}

      <div className="mx-auto flex max-w-[1600px] flex-col gap-2.5 py-2.5 pr-3 pl-14 sm:py-3 sm:pr-6 lg:pl-6 md:flex-row md:items-center md:gap-4">
        {/* Row 1 — brand, format readout, status, theme */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border backdrop-blur-sm transition-colors duration-300 sm:h-10 sm:w-10 ${
              isRecording
                ? 'border-rec/50 bg-rec/12 text-rec'
                : 'border-cyan/35 bg-cyan/10 text-cyan'
            }`}
          >
            <AudioWaveform className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
          </span>

          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-bold tracking-[0.18em] uppercase text-ink sm:text-sm sm:tracking-[0.2em]">
              Tone Studio
            </h1>
            <p className="truncate font-mono text-[10px] text-ink-3 sm:text-[11px]">
              {projectName}
            </p>
          </div>

          {/* Status sits on the brand row on phones to save vertical space */}
          <div className="ml-auto md:hidden">
            <StatusBadge status={status} />
          </div>
        </div>

        {/* Stream format — only where there is room for it */}
        <div className="hidden items-center gap-1.5 xl:flex">
          <Chip tone={format ? 'strong' : 'muted'} title="Stream sample rate">
            {format ? formatSampleRate(format.sampleRate) : '—'}
          </Chip>
          <Chip tone="muted" title="Output bit depth">
            {format ? `${format.bitDepth}-bit` : '—'}
          </Chip>
          <Chip tone="muted" title="Channel configuration">
            {format ? formatChannels(format.channels) : '—'}
          </Chip>
          <Chip tone="muted">WAV</Chip>
        </div>

        {/* Row 2 on phones — input routing, full width for an easy tap target */}
        <div className="flex items-center gap-2 md:ml-auto md:gap-3">
          {permission === 'granted' && (
            <div className="mr-2 hidden md:block">
              <LevelMeter
                meterRef={meterRef}
                channels={channels}
                active={status !== 'idle' && status !== 'error'}
                compact
              />
            </div>
          )}
          {permission === 'granted' && (
            <div className="mr-4 hidden flex-col items-stretch select-none md:flex">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] font-bold text-ink-3 uppercase mr-1">Master</span>
                <button
                  type="button"
                  disabled={!isMonitoring}
                  title="ลดเสียงมอนิเตอร์รวมทีละ 1%"
                  className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border border-cyan/60 bg-cyan/20 hover:bg-cyan/35 active:scale-95 text-cyan hover:text-white transition-all duration-100 disabled:pointer-events-none disabled:opacity-20 font-mono text-[13px] font-bold shadow-md shadow-cyan/10"
                  {...masterDecHandlers}
                >
                  -
                </button>
                <div className="min-w-0 w-32 sm:w-56">
                  <MiniSlider
                    label=""
                    value={masterVolume}
                    min={0}
                    max={1.5}
                    step={0.01}
                    disabled={!isMonitoring}
                    inputClassName="fader-cyan"
                    onChange={onChangeMasterVolume}
                  />
                </div>
                <button
                  type="button"
                  disabled={!isMonitoring}
                  title="เพิ่มเสียงมอนิเตอร์รวมทีละ 1%"
                  className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border border-cyan/60 bg-cyan/20 hover:bg-cyan/35 active:scale-95 text-cyan hover:text-white transition-all duration-100 disabled:pointer-events-none disabled:opacity-20 font-mono text-[13px] font-bold shadow-md shadow-cyan/10"
                  {...masterIncHandlers}
                >
                  +
                </button>
              </div>
              <span className={`text-center font-mono text-[9px] tabular-nums mt-0.5 select-none transition-colors duration-150 pl-10 ${isMonitoring ? 'text-ink-2' : 'text-ink-3/40'}`}>
                {Math.round(masterVolume * 100)}%
              </span>
            </div>
          )}
          <DeviceSelect
            devices={devices}
            activeDeviceId={activeDeviceId}
            permission={permission}
            isBusy={isBusy}
            onSelect={onSelectDevice}
            onRefresh={onRefreshDevices}
            onRequestAccess={onRequestAccess}
          />

          <div className="hidden md:flex">
            <StatusBadge status={status} />
          </div>
        </div>
      </div>
    </header>
  );
}
