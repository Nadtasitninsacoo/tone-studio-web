'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerRegistrar — registers `public/sw.js`, in production only.
 *
 * Renders nothing; it exists to run one effect at the root.
 *
 * **Production only, and that is not laziness.** `next dev` serves modules that a
 * service worker has no business standing between: HMR sockets, on-demand compiled
 * chunks, and URLs that change identity between reloads. A worker in the loop there
 * produces "why is my edit not showing" bugs that look like a build problem for an
 * hour before anyone suspects the cache.
 *
 * Registered on `load` rather than on mount, so it never competes for bandwidth with
 * the page it is meant to make available offline.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // A refused registration is not worth surfacing: the app works without it,
        // and the only thing lost is offline use and the install prompt.
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
