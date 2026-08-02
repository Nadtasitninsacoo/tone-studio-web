/**
 * Keeping an `AudioContext` running, and noticing when it has stopped.
 *
 * A device dropping out is not the only way the sound stops. The other one is the
 * context itself: Windows resets an audio endpoint (a USB interface appearing or
 * disappearing, a sample-rate change, an exclusive-mode grab, a driver reload)
 * and the browser's render thread goes with it. Two shapes of that failure exist,
 * and neither one raises an error anybody was listening for:
 *
 *  - **Suspended.** The context's state changes and `currentTime` stops. Nothing
 *    plays, no event is dispatched to the page's own code, and every button still
 *    looks armed. `resume()` fixes it, so the cure is to watch for it and call
 *    `resume()` — which is what an engine that "cut out for no reason" needs.
 *  - **Stalled.** The state still reads `'running'` but `currentTime` no longer
 *    advances: the output stream underneath died. There is no state change and no
 *    event at all, so the only way to know is to look at the clock. Everything in
 *    this app is scheduled against that clock, so a stalled context is a silent
 *    page with a playhead that has stopped moving.
 *
 * The clock check is why this is a poll rather than a `statechange` listener. It
 * runs twice a second, reads two numbers, and is the cheapest thing in the app.
 *
 * The gesture path is separate and equally necessary: Chrome may refuse a
 * programmatic `resume()` when the page has not been interacted with recently,
 * and answering that refusal by doing nothing leaves a dead page. Resuming on the
 * next pointer or key event costs nothing and covers it.
 *
 * Unverified in a browser, like everything else on the recovery path. The stall
 * detector's arithmetic is checked from Node.
 */

/** How often the clock is sampled. */
const DEFAULT_INTERVAL_MS = 500;

/**
 * How long the clock may stand still before the context is declared dead.
 *
 * Generous on purpose. A busy main thread can delay the poll itself, and a
 * context that is merely being slow must not be torn down and rebuilt underneath
 * a player mid-take. Anything above a second of a *stopped* clock is not
 * slowness — at 48 kHz that is 48,000 samples that were never rendered.
 */
const DEFAULT_STALL_MS = 1500;

/**
 * Clock movement below this counts as none at all.
 *
 * `currentTime` advances in render quanta (128 samples, ~2.7 ms at 48 kHz), so
 * anything under a millisecond over a 500 ms window is noise, not progress.
 */
const CLOCK_EPSILON = 1e-3;

export interface StallDetector {
  /**
   * Feed the context clock and a wall clock, both in the same units as their
   * sources (`ctx.currentTime` in seconds, `performance.now()` in ms).
   * Returns true once the clock has been still for the whole stall window.
   */
  push: (ctxTime: number, now: number) => boolean;
  /** Forget the history — after a rebuild, or while the context is suspended. */
  reset: () => void;
}

/**
 * Pure clock-stall arithmetic, so the decision can be checked without an
 * `AudioContext`.
 *
 * Deliberately *not* "has the clock moved since the last sample": on a machine
 * where the poll fires slightly early relative to a render quantum, that is true
 * often enough to fire constantly. It tracks the last time the clock was seen to
 * advance and reports how long ago that was.
 */
export function createStallDetector(stallMs: number = DEFAULT_STALL_MS): StallDetector {
  let anchorTime = Number.NaN;
  let anchorAt = 0;

  return {
    push(ctxTime: number, now: number): boolean {
      if (Number.isNaN(anchorTime)) {
        anchorTime = ctxTime;
        anchorAt = now;
        return false;
      }
      if (ctxTime > anchorTime + CLOCK_EPSILON) {
        anchorTime = ctxTime;
        anchorAt = now;
        return false;
      }
      return now - anchorAt >= stallMs;
    },
    reset() {
      anchorTime = Number.NaN;
      anchorAt = 0;
    },
  };
}

export interface ContextHealthOptions {
  /**
   * The clock stopped while the context claimed to be running.
   *
   * The graph is gone; the caller has to rebuild it. Called once per stall — the
   * detector is reset before the call, so a caller that does nothing gets told
   * again one stall window later rather than sixty times a second.
   */
  onStalled: () => void;
  /** A suspended context was resumed. Worth clearing a warning on. */
  onResumed?: () => void;
  /**
   * `resume()` was refused. Usually the autoplay policy, which the gesture
   * listener below then handles — so this is a warning, not a failure.
   */
  onResumeFailed?: (cause: unknown) => void;
  intervalMs?: number;
  stallMs?: number;
  /**
   * Whether the context is suspended **on purpose** right now.
   *
   * Without this, a deliberate suspend is indistinguishable from the failure this
   * watchdog exists to fix, and the two fight: the app parks the context to stop its DSP,
   * the poll sees `'suspended'` half a second later and resumes it. The engine that is
   * parked is also the one nobody is listening to, so the symptom is not silence — it is
   * a machine doing double the work for no sound, which is the hardest kind to notice.
   *
   * A parked context is skipped entirely, clock included: its clock is *meant* to be
   * standing still, so the stall detector would otherwise declare it dead on schedule.
   */
  isParked?: () => boolean;
}

/**
 * Watch one context: resume it when it suspends, report it when it stalls.
 *
 * Returns a disposer. Safe to call on a context that is later closed — a closed
 * context stops the watch rather than reporting it, because closing is something
 * the app does on purpose.
 */
export function watchAudioContext(ctx: AudioContext, options: ContextHealthOptions): () => void {
  const { onStalled, onResumed, onResumeFailed, isParked } = options;
  const detector = createStallDetector(options.stallMs ?? DEFAULT_STALL_MS);
  let resuming = false;
  let stopped = false;

  const timer = window.setInterval(() => {
    if (stopped) return;

    // Parked by the app. Not a fault, and not ours to undo — see `isParked`.
    if (isParked?.()) {
      detector.reset();
      return;
    }

    // `'interrupted'` is Safari's, and is not in the DOM types. It is the same
    // situation as `'suspended'` and wants the same answer.
    const state = ctx.state as string;

    if (state === 'closed') {
      stop();
      return;
    }

    if (state !== 'running') {
      detector.reset();
      if (resuming) return;
      resuming = true;
      void ctx
        .resume()
        .then(() => {
          resuming = false;
          onResumed?.();
        })
        .catch((cause: unknown) => {
          resuming = false;
          onResumeFailed?.(cause);
        });
      return;
    }

    if (detector.push(ctx.currentTime, performance.now())) {
      // Reset before reporting: the clock is still stopped, and a caller that
      // rebuilds asynchronously must not be told again on the next tick.
      detector.reset();
      onStalled();
    }
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
  }

  return stop;
}

/**
 * Resume a suspended context on the next user gesture.
 *
 * Left installed for the life of the context rather than removed after the first
 * gesture: a context can be suspended more than once per session, and each time
 * the autoplay policy may want a fresh gesture. Passive and capturing, so it
 * never interferes with the control that was actually clicked.
 *
 * `isParked` is the same exemption the poll takes: a context the app suspended on purpose
 * must not come back on the next click anywhere on the page. Without it this listener is
 * the *more* aggressive of the two — every keystroke is a gesture.
 */
export function resumeOnGesture(ctx: AudioContext, isParked?: () => boolean): () => void {
  const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];

  const onGesture = () => {
    if (isParked?.()) return;
    if ((ctx.state as string) === 'running' || ctx.state === 'closed') return;
    void ctx.resume().catch(() => {
      // Nothing else to try here; the poll above will keep asking.
    });
  };

  for (const event of events) {
    window.addEventListener(event, onGesture, { capture: true, passive: true });
  }

  return () => {
    for (const event of events) {
      window.removeEventListener(event, onGesture, { capture: true });
    }
  };
}
