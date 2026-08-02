/**
 * Classify a `getUserMedia` failure.
 *
 * Pure, so it can be checked from Node like the rest of `lib/`.
 *
 * This exists because "input access was blocked" was being reported for every
 * failure, including the ones that are not about permission at all. During the
 * first real hardware session that message sent the debugging in the wrong
 * direction: the pedal was enumerated and Windows-level microphone privacy was
 * `Allow`, so "blocked" pointed at the OS when the answer was in the browser's own
 * per-site setting. Naming the actual DOMException is the difference between a
 * dead end and a next step — the same reason `startBackingCapture` reports the
 * specific reason a tab share failed instead of greying its button out.
 */

export type MediaErrorKind =
  /** The user or a policy refused access. Only this one means "permission". */
  | 'blocked'
  /** No device matched — unplugged between enumerate and open. */
  | 'missing'
  /** The device exists but could not be opened: in use, or the driver refused. */
  | 'busy'
  /** The device exists but cannot satisfy the requested constraints. */
  | 'constraints'
  /** The browser does not offer capture here at all. */
  | 'unsupported'
  | 'unknown';

/** Map a rejection from `getUserMedia` to a kind. */
export function mediaErrorKind(cause: unknown): MediaErrorKind {
  const name = cause instanceof Error ? cause.name : '';

  switch (name) {
    case 'NotAllowedError':
    // Pre-spec name still emitted by some builds.
    case 'PermissionDeniedError':
    // Thrown for an insecure origin or a blocking permissions policy. Grouped with
    // `blocked` because the user-visible situation is the same: not permitted here.
    case 'SecurityError':
      return 'blocked';

    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'missing';

    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';

    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'constraints';

    case 'TypeError':
      return 'unsupported';

    default:
      return 'unknown';
  }
}

/**
 * A message that says what to do next.
 *
 * Each one names where the setting lives, because "allow microphone access" is not
 * actionable when the OS already allows it and the browser is the one refusing.
 */
export function mediaErrorMessage(cause: unknown): string {
  switch (mediaErrorKind(cause)) {
    case 'blocked':
      return 'The browser refused microphone access for this site. Open the padlock or tune icon beside the address bar, set Microphone to Allow, then reload.';
    case 'missing':
      return 'No audio input was found. Connect the interface and rescan — a charge-only USB cable carries no data, so the pedal never appears.';
    case 'busy':
      return 'The input device could not be opened. Another application may be holding it, or the driver refused — close other audio software and try again.';
    case 'constraints':
      return 'The input device cannot provide the requested audio format.';
    case 'unsupported':
      return 'This browser does not support audio capture here.';
    case 'unknown':
      // The DOMException name is worth more to a user filing a bug than a guess.
      return cause instanceof Error && cause.name
        ? `Could not open the input device (${cause.name}).`
        : 'Could not open the input device.';
  }
}

/**
 * Whether a failure should be recorded as a denied permission.
 *
 * Only a real refusal. Reporting `denied` for a missing or busy device leaves the
 * UI telling the user to grant access they have already granted, and hides the
 * actual fault.
 */
export function isPermissionFailure(cause: unknown): boolean {
  return mediaErrorKind(cause) === 'blocked';
}
