'use client';

import { Download, Share } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useClientCapability } from '@/hooks/useClientCapability';

/**
 * The event Chromium fires when it decides the app is installable.
 *
 * Not in the DOM lib, because it is not in any standard — Firefox and Safari never
 * fire it. Declared here rather than augmenting the global `WindowEventMap`, so the
 * fact that this is one engine's extension stays visible at the point of use.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** True when the page is already running as an installed app. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS predates the media query and still reports it here only.
    ('standalone' in window.navigator && window.navigator.standalone === true)
  );
}

/** True on an iPhone or iPad, where installing is a manual Share-sheet action. */
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch points are what give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * InstallApp — the button that puts this on the device.
 *
 * ---------------------------------------------------------------------------
 * Three states, because three platforms behave differently.
 *
 * 1. **Chromium** fires `beforeinstallprompt`. Capturing it (and calling
 *    `preventDefault`) suppresses the browser's own mini-infobar and hands us the
 *    prompt to fire from a real button, which is the only way it can sit somewhere
 *    the user will look. The event may arrive well after hydration, so this renders
 *    nothing until it does — a dead install button is worse than none.
 * 2. **iOS Safari** has no such event and never will. Installing is Share → Add to
 *    Home Screen, so all this can do is say so. Worth doing rather than hiding: this
 *    is a recording app, and a phone in a rehearsal room is the case where an
 *    installed shortcut earns the most.
 * 3. **Already installed** — nothing to show. Detected through
 *    `useClientCapability`, not `useState` in an effect: reading `matchMedia` during
 *    render is the hydration mismatch that hook exists to prevent, and setting state
 *    in an effect is a lint error in this project.
 *
 * The `beforeinstallprompt` listener is registered unconditionally. Cheap, and the
 * alternative — gating it on a capability check — would miss the event on any browser
 * whose behaviour is not what the check assumed.
 * ---------------------------------------------------------------------------
 */
export function InstallApp({ isCollapsed }: { isCollapsed: boolean }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [alreadyInstalled, setAlreadyInstalled] = useState(false);

  const installed = useClientCapability(isStandalone);
  const ios = useClientCapability(isIos);

  useEffect(() => {
    // 1. Check local storage flag
    if (typeof window !== 'undefined') {
      const isFlagged = localStorage.getItem('pwa-installed') === 'true';
      if (isFlagged) {
        setAlreadyInstalled(true);
      }
    }

    // 2. Query browser related apps API (Chromium)
    if (typeof navigator !== 'undefined' && 'getInstalledRelatedApps' in navigator) {
      (navigator as any).getInstalledRelatedApps().then((apps: any[]) => {
        if (apps && apps.length > 0) {
          setAlreadyInstalled(true);
          localStorage.setItem('pwa-installed', 'true');
        }
      }).catch(() => {});
    }

    const onPrompt = (event: Event) => {
      // Suppresses Chromium's own infobar. Without it the browser shows its banner
      // *and* this button, which reads as two different offers.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    
    const onInstalled = () => {
      setPromptEvent(null);
      setAlreadyInstalled(true);
      localStorage.setItem('pwa-installed', 'true');
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || alreadyInstalled || dismissed) return null;

  // iOS: a hint, not a button. Only in the expanded sidebar — two lines of
  // instructions in a 64px rail is not a hint, it is a wall.
  if (!promptEvent) {
    if (!ios || isCollapsed) return null;
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-line bg-inset px-2 py-1.5 text-[10px] leading-snug text-ink-3">
        <Share aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          ติดตั้งลงเครื่อง: กด <strong className="font-semibold text-ink-2">แชร์</strong> แล้วเลือก{' '}
          <strong className="font-semibold text-ink-2">Add to Home Screen</strong>
        </span>
      </p>
    );
  }

  const install = async () => {
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // The event is single-use either way: Chromium will fire a fresh one if the app
    // is still installable later, so holding a spent one would leave a button that
    // does nothing.
    setPromptEvent(null);
    if (outcome === 'dismissed') setDismissed(true);
  };

  return (
    <button
      type="button"
      onClick={() => void install()}
      title="ติดตั้งลงเครื่อง — เปิดได้จากหน้าจอหลักโดยไม่ต้องผ่านเบราว์เซอร์"
      className={`flex items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/8 text-cyan transition-colors duration-200 hover:bg-cyan/16 ${
        isCollapsed ? 'h-9 w-9 justify-center' : 'px-2.5 py-1.5'
      }`}
    >
      <Download aria-hidden className="h-4 w-4 shrink-0" />
      {isCollapsed ? null : (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[12px] font-semibold leading-tight">
            ติดตั้งลงเครื่อง
          </span>
          <span className="block truncate text-[9px] leading-tight text-ink-3">
            เปิดจากหน้าจอหลักได้เลย
          </span>
        </span>
      )}
    </button>
  );
}
