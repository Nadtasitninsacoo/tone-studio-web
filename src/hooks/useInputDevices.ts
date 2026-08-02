'use client';

import { useCallback, useEffect, useState } from 'react';

import { inputConstraints } from '@/lib/inputSession';
import { isPermissionFailure, mediaErrorMessage } from '@/lib/mediaErrors';
import type { DevicePermission, InputDevice } from '@/types/recorder';

/** Labels that indicate an external USB audio interface rather than a built-in mic. */
const INTERFACE_PATTERN =
  /usb|audio\s*interface|line\s*in|scarlett|focusrite|behringer|steinberg|zoom\s*h|presonus|m-?audio|tascam|roland|boss|yamaha|guitar/i;

/** The specific pedal this app targets. M-VAVE enumerates under several spellings. */
const TANK_G_PATTERN = /tank[\s-]?g|m-?vave|mvave/i;

/**
 * Bluetooth headset-profile endpoints. Windows names these "Hands-Free AG Audio",
 * macOS just uses the device name, so this is a best-effort match — the
 * authoritative check is the stream's actual sample rate once it opens.
 */
const BLUETOOTH_PATTERN = /bluetooth|hands-?free|headset|\bbt\b|airpods|a2dp|hfp/i;

/**
 * Enumerate audio inputs and track permission state.
 *
 * Browsers hide device labels until the user grants mic access, so the flow is:
 * enumerate (may be unlabeled) -> `requestAccess()` -> re-enumerate with labels.
 * A `devicechange` listener keeps the list live when the pedal is plugged in or out.
 */
export function useInputDevices() {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [permission, setPermission] = useState<DevicePermission>('unknown');
  const [isEnumerating, setIsEnumerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setError('This browser does not expose audio input devices.');
      return;
    }

    setIsEnumerating(true);
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((device) => device.kind === 'audioinput')
        // `default`/`communications` are OS aliases that duplicate a real device.
        .filter((device) => device.deviceId !== 'communications')
        .map<InputDevice>((device, index) => {
          const label = device.label || `Audio Input ${index + 1}`;
          const isBluetooth = BLUETOOTH_PATTERN.test(label);
          return {
            deviceId: device.deviceId,
            label,
            groupId: device.groupId,
            // A Bluetooth headset is never the wired interface we want, even if
            // its name happens to contain "audio" or a brand we recognise.
            isInterface: !isBluetooth && INTERFACE_PATTERN.test(label),
            isTankG: !isBluetooth && TANK_G_PATTERN.test(label),
            isBluetooth,
          };
        });

      // Tank-G first, then other wired interfaces, then system inputs, with
      // Bluetooth endpoints last — they cannot carry full-bandwidth audio.
      inputs.sort((a, b) => {
        const rank = (device: InputDevice) =>
          device.isTankG ? 0 : device.isInterface ? 1 : device.isBluetooth ? 3 : 2;
        return rank(a) - rank(b);
      });

      setDevices(inputs);
      setError(null);
    } catch {
      setError('Could not read the audio device list.');
    } finally {
      setIsEnumerating(false);
    }
  }, []);

  /** Prompt for input access, then re-enumerate so real device labels appear. */
  const requestAccess = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support audio capture.');
      setPermission('denied');
      return false;
    }

    try {
      /**
       * The same constraints as the real open, not `{ audio: true }`.
       *
       * This call only exists to make the browser reveal device labels, and the stream is
       * stopped immediately — but `{ audio: true }` means Chrome's defaults, which are
       * echo cancellation, noise suppression and automatic gain control. Chrome attaches
       * its audio processing to the *device session*, so opening the interface with the
       * voice-chat DSP on, even for a moment, can leave that configuration in place for
       * the stream that follows however explicitly it asks for `false`. The symptoms are
       * a guitar that pumps and a decay that disappears.
       *
       * Whether that actually happens here is what the `[input] IGNORED:` warning in
       * `lib/inputSession.ts` is there to establish. Asking correctly costs nothing either
       * way, and one place deciding what "our input" means is the point of
       * `inputConstraints`.
       */
      const stream = await navigator.mediaDevices.getUserMedia(inputConstraints(''));
      // We only needed the permission grant — the engine opens its own stream.
      stream.getTracks().forEach((track) => track.stop());
      setPermission('granted');
      setError(null);
      await refresh();
      return true;
    } catch (cause) {
      // Only a real refusal counts as denied. Calling a missing or busy device
      // "denied" leaves the banner telling the user to grant access they already
      // granted, which is exactly the wrong place to go looking.
      if (isPermissionFailure(cause)) setPermission('denied');
      setError(mediaErrorMessage(cause));
      return false;
    }
  }, [refresh]);

  // Initial probe: read the Permissions API when available, then enumerate.
  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      try {
        const status = await navigator.permissions?.query({
          name: 'microphone' as PermissionName,
        });
        if (!cancelled && status) {
          setPermission(status.state as DevicePermission);
          status.onchange = () => setPermission(status.state as DevicePermission);
        }
      } catch {
        // Firefox/Safari may not expose the `microphone` descriptor — non-fatal.
      }
      if (!cancelled) await refresh();
    };

    void probe();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Keep the list in sync when hardware is connected or removed mid-session.
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const onChange = () => void refresh();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refresh]);

  return { devices, permission, isEnumerating, error, refresh, requestAccess };
}
