'use client';

import { useRef } from 'react';

import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { formatTimecode } from '@/lib/format';

interface PlayheadClockProps {
  /** Live playhead getter — `useJam`'s `getPlayhead`. */
  getPlayhead: () => number;
  /**
   * The value React renders. Correct while nothing is moving and after a discrete
   * seek; during playback the animation frame below overwrites it.
   */
  playhead: number;
  /** Run the paint loop. False when nothing moves, so an idle route stays idle. */
  active: boolean;
  className?: string;
}

/**
 * PlayheadClock — a transport's HH:MM:SS readout. Shared by the editor and jam.
 *
 * Painted straight into the DOM from an animation frame, the same way
 * `recorder/TimeCode` handles the capture counter. It exists because both engines'
 * playhead state deliberately no longer updates every frame: the workspace, the
 * timeline and every clip or layer would re-render sixty times a second to move one
 * text node and one vertical line.
 *
 * The rendered fallback is not redundant. It is what makes the readout correct on
 * the server, on the first paint, and whenever the loop is not running.
 */
export function PlayheadClock({
  getPlayhead,
  playhead,
  active,
  className,
}: PlayheadClockProps) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const lastRef = useRef('');

  useAnimationFrame(() => {
    const stamp = formatTimecode(getPlayhead());
    // Only touch the DOM when the rendered text actually changes — at 60 fps this
    // is a write roughly once a second.
    if (stamp === lastRef.current) return;
    lastRef.current = stamp;
    if (nodeRef.current) nodeRef.current.textContent = stamp;
  }, active);

  return (
    <span ref={nodeRef} className={className}>
      {formatTimecode(playhead)}
    </span>
  );
}
