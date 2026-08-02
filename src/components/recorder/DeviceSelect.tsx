'use client';

import { Check, ChevronDown, Guitar, Mic, RefreshCw, Usb } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { DevicePermission, InputDevice } from '@/types/recorder';

interface DeviceSelectProps {
  devices: InputDevice[];
  activeDeviceId: string | null;
  permission: DevicePermission;
  isBusy: boolean;
  onSelect: (device: InputDevice) => void;
  onRefresh: () => void;
  onRequestAccess: () => void;
}

/**
 * DeviceSelect — input source picker for the header bar.
 *
 * A custom listbox rather than a native <select> so each row can carry hardware
 * badges (USB / Tank-G) and the "grant access" state. Implements the ARIA
 * button+listbox pattern with roving focus, so it stays keyboard-usable. On
 * phones the popover spans the viewport width instead of the trigger width.
 */
export function DeviceSelect({
  devices,
  activeDeviceId,
  permission,
  isBusy,
  onSelect,
  onRefresh,
  onRequestAccess,
}: DeviceSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const active = devices.find((device) => device.deviceId === activeDeviceId) ?? null;
  const needsAccess = permission !== 'granted';

  const close = useCallback(() => setIsOpen(false), []);

  // Dismiss on outside press or Escape — expected behaviour for a popover.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, close]);

  // Move DOM focus to the highlighted option so screen readers follow along.
  useEffect(() => {
    if (!isOpen) return;
    const option = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    option?.focus();
  }, [isOpen, activeIndex]);

  const openList = () => {
    if (needsAccess) {
      onRequestAccess();
      return;
    }
    const currentIndex = devices.findIndex((device) => device.deviceId === activeDeviceId);
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
    setIsOpen(true);
  };

  const commit = (device: InputDevice) => {
    onSelect(device);
    close();
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (devices.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + direction + devices.length) % devices.length);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(devices.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(devices[activeIndex]);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-auto">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={() => (isOpen ? close() : openList())}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          className="group flex min-w-0 flex-1 touch-manipulation items-center gap-2.5 rounded-full border border-line bg-raised px-2.5 py-2 text-left backdrop-blur-sm transition-all duration-300 hover:border-cyan/40 hover:bg-panel active:scale-[0.99] sm:w-60 sm:flex-none sm:px-3"
        >
          <DeviceIcon device={active} needsAccess={needsAccess} />

          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9px] font-medium tracking-[0.16em] uppercase text-ink-3">
              Input Device
            </span>
            <span className="block truncate text-sm font-medium text-ink">
              {needsAccess
                ? 'Grant input access'
                : (active?.label ?? (devices.length ? 'Select an input' : 'No inputs found'))}
            </span>
          </span>

          {active?.isTankG ? (
            <span className="hidden shrink-0 rounded-full border border-cyan/40 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase text-cyan lg:block">
              Tank-G
            </span>
          ) : null}

          <ChevronDown
            aria-hidden
            className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-300 ease-out-expo group-hover:text-ink ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        <button
          type="button"
          onClick={onRefresh}
          title="Rescan audio devices"
          aria-label="Rescan audio devices"
          className="flex w-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-line bg-raised backdrop-blur-sm text-ink-3 transition-all duration-300 hover:border-cyan/40 hover:text-cyan active:scale-95 sm:w-9"
        >
          <RefreshCw aria-hidden className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isOpen ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Audio input devices"
          onKeyDown={onListKeyDown}
          className="absolute right-0 left-0 z-50 mt-2 max-h-72 animate-pop-in overflow-y-auto rounded-2xl border border-line bg-solid/95 p-1.5 backdrop-blur-xl shadow-lifted sm:left-auto sm:w-80"
        >
          {devices.length === 0 ? (
            <li className="px-3 py-4 text-center text-xs text-ink-3">
              No audio inputs detected. Connect your interface and rescan.
            </li>
          ) : (
            devices.map((device, index) => {
              const isActive = device.deviceId === activeDeviceId;
              return (
                <li
                  key={device.deviceId || `device-${index}`}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  onClick={() => commit(device)}
                  style={{ animationDelay: `${index * 30}ms` }}
                  className={`flex animate-rise-in cursor-pointer touch-manipulation items-center gap-3 rounded-xl px-2.5 py-2.5 outline-none transition-colors duration-150 ${
                    isActive ? 'bg-cyan/10' : 'hover:bg-raised focus:bg-raised'
                  }`}
                >
                  <DeviceIcon device={device} needsAccess={false} />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{device.label}</span>
                    <span
                      className={`block font-mono text-[10px] tracking-wider uppercase ${
                        device.isBluetooth ? 'text-rec' : 'text-ink-3'
                      }`}
                    >
                      {device.isTankG
                        ? 'M-VAVE Tank-G · USB Audio'
                        : device.isInterface
                          ? 'USB Audio Interface'
                          : device.isBluetooth
                            ? // Bluetooth can only offer the mono, ~8–16 kHz headset
                              // profile as an input — worth saying before they pick it.
                              'Bluetooth · voice quality only'
                            : 'System Input'}
                    </span>
                  </span>

                  {isActive ? (
                    <Check aria-hidden className="h-4 w-4 shrink-0 text-cyan" />
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Icon tile reflecting what kind of hardware the row represents. */
function DeviceIcon({
  device,
  needsAccess,
}: {
  device: InputDevice | null;
  needsAccess: boolean;
}) {
  const Icon = needsAccess ? Mic : device?.isTankG ? Guitar : device?.isInterface ? Usb : Mic;

  // The recognised pedal gets the accent; everything else stays greyscale.
  const tone =
    !needsAccess && device?.isTankG
      ? 'border-cyan/40 bg-cyan/10 text-cyan'
      : 'border-line bg-raised text-ink-2';

  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors duration-300 ${tone}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}
