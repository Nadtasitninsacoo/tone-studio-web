/**
 * Types shared by anything that imports media, currently the editor and the jam
 * page. Both report an import the same way so one toast can serve both.
 */

/**
 * What a finished video import produced.
 *
 * `id` is minted per import rather than derived from the file: picking the same
 * file twice must re-announce it, and a stable id would leave the second import
 * silent because nothing about the value changed.
 */
export interface VideoImportSummary {
  id: string;
  name: string;
  /** Object URL of the imported file, used for the confirmation's poster frame. */
  url: string;
  durationSec: number;
  width: number;
  height: number;
  /** Size of the picked file, in bytes. */
  bytes: number;
  /**
   * Whether the video's own audio reached the audio graph. Null when the page
   * does not decode it up front — the editor decodes per clip, on demand, so it
   * has nothing honest to say here at import time.
   */
  hasBacking: boolean | null;
}
