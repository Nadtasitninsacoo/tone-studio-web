/**
 * Folding the sidebar away on the pages that need the width.
 *
 * Pure: a reducer over (where you were, where you are, what the sidebar is doing).
 * No React, no router, no store — so it compiles with
 * `npx tsc --outDir <tmp> --module commonjs` and is checked from plain Node.
 *
 * ---------------------------------------------------------------------------
 * The whole difficulty is one sentence: **an automatic behaviour must never fight
 * the person using it.**
 *
 * The naive version is an effect that says "on /mixer, collapse". It re-runs on
 * every render and every re-navigation, so the moment the player opens the sidebar
 * back up while they are on the desk, it shuts again. That is not a small annoyance
 * — it is the app arguing, and this codebase has already paid for that lesson once
 * with `MonitorHandover`, where a watcher that read the route and acted on it took
 * the sound away from whichever page you navigated off.
 *
 * The difference here is that width is not sound, so acting on a navigation is
 * allowed. What is not allowed is acting on it *twice*, or undoing a choice the
 * player made by hand. Hence a reducer with two pieces of memory:
 *
 * - **`ours`** — did *we* collapse it? Only something we did may be undone. A
 *   sidebar the player had already collapsed is not ours to reopen when they leave.
 * - **`restoreTo`** — what it was before we touched it, so leaving a wide page puts
 *   it back rather than guessing at `false`.
 *
 * And one rule that makes the whole thing safe to run anywhere: **a call that
 * changes nothing returns `collapsed: null`.** The effect can run on every render.
 * ---------------------------------------------------------------------------
 */

/**
 * The routes that get the width.
 *
 * `/amp` is the Rig page — see the vocabulary table in AGENTS.md. The path is the
 * load-bearing name; only the label moved.
 */
export const WIDE_ROUTES: readonly string[] = ['/amp', '/mixer'];

export function isWideRoute(path: string): boolean {
  // Tolerant of a trailing slash, and of nothing at all. `''` is not `/`.
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return WIDE_ROUTES.includes(clean);
}

export interface AutoCollapseState {
  /** The path the last decision was made for. `null` before the first one. */
  path: string | null;
  /** True while the current collapse is ours rather than the player's. */
  ours: boolean;
  /** What to put back when a wide page is left. `null` when nothing is owed. */
  restoreTo: boolean | null;
}

export interface AutoCollapseDecision {
  /** What to write to the sidebar store, or `null` for "leave it alone". */
  collapsed: boolean | null;
  next: AutoCollapseState;
}

export const INITIAL_AUTO_COLLAPSE: AutoCollapseState = {
  path: null,
  ours: false,
  restoreTo: null,
};

function unchanged(state: AutoCollapseState): AutoCollapseDecision {
  return { collapsed: null, next: state };
}

/**
 * Decide what the sidebar should do, given where we are and what it is doing.
 *
 * Safe to call on every render: it only returns a write when something actually
 * has to change.
 */
export function decideAutoCollapse(
  state: AutoCollapseState,
  path: string,
  isCollapsed: boolean,
): AutoCollapseDecision {
  const wide = isWideRoute(path);

  /* ---- Still on the same page ---------------------------------------------
     Nothing to fold or unfold, but there is something to *notice*: if this
     collapse was ours and the sidebar is now open, the player opened it. That
     ends our claim on it — we must not fold it again while they stay here, and
     we must not "restore" anything when they leave, because the state they are
     looking at is the one they chose.                                        */
  if (state.path === path) {
    if (state.ours && !isCollapsed) {
      return { collapsed: null, next: { ...state, ours: false, restoreTo: null } };
    }
    return unchanged(state);
  }

  /* ---- Arriving somewhere wide --------------------------------------------
     Including on a cold load: opening the desk straight from a bookmark is
     arriving at it. `restoreTo` captures what the player's stored preference was
     so leaving can put it back, rather than assuming everyone wants it open.

     Already collapsed is the case worth being careful about. There is nothing to
     do, and `ours` stays false — claiming a collapse we did not perform would
     mean opening a sidebar the player had deliberately shut, on their way out of
     a page they never asked us to change.                                     */
  if (wide) {
    /* Wide to wide — the Rig page to the desk — decides nothing, and must not.
       The branch below reads "already folded" as "the player folded it", which is
       right on the way in from the recorder and wrong here: it is folded because
       *we* folded it one page ago. Dropping the claim there meant a sidebar we had
       folded stopped being ours the moment the player opened the desk, and was
       never put back — `/` -> `/amp` -> `/mixer` -> `/` left it shut.

       Carrying the state forward also carries a *manual* choice forward, which is
       the same rule seen from the other side: someone who opened the sidebar on the
       Rig page and walked to the desk asked for it open, and folding it again on
       arrival would be the argument this whole file exists to avoid. */
    if (state.path !== null && isWideRoute(state.path)) {
      return { collapsed: null, next: { ...state, path } };
    }
    if (isCollapsed) {
      return { collapsed: null, next: { path, ours: false, restoreTo: null } };
    }
    return { collapsed: true, next: { path, ours: true, restoreTo: false } };
  }

  /* ---- Leaving for somewhere narrow ---------------------------------------
     Put back only what we took. `ours` is false whenever the player has had a
     hand in it, and then the sidebar simply stays as they left it.            */
  if (state.ours && state.restoreTo !== null && state.restoreTo !== isCollapsed) {
    return { collapsed: state.restoreTo, next: { path, ours: false, restoreTo: null } };
  }

  return { collapsed: null, next: { path, ours: false, restoreTo: null } };
}
