/**
 * Fetching a video the app was given a link to.
 *
 * This is the one kind of link that can be *edited*: a direct file URL the server
 * is willing to hand over. Once the bytes are here it is indistinguishable from a
 * file the user picked — decodable, cuttable, exportable, storable in the draft.
 *
 * A YouTube page URL is not that, and no amount of client code makes it one. The
 * page is not the video; the media itself sits behind a cross-origin player that
 * exposes neither its samples nor its frames. Anything that pretends otherwise is
 * lying to the user about what they will get out the other end.
 */

/** Normalise what a user pasted into something `fetch` accepts. */
export function toHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    // A pasted link is routinely missing its scheme.
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Last path segment, so the asset carries a name a person recognises. */
function nameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop();
  return last && last.length <= 120 ? decodeURIComponent(last) : 'linked-video';
}

/**
 * Download a linked video into a File.
 *
 * Deliberately whole-file rather than streamed: everything downstream — decoding
 * the audio, probing the duration, storing the draft, re-encoding on export —
 * needs the complete bytes, and a partial fetch would only defer the wait.
 *
 * The CORS failure is called out by name because it is by far the most common
 * outcome and the least obvious: the link works perfectly in a browser tab and
 * still cannot be read by a script on another origin.
 */
export async function fetchLinkedVideo(input: string): Promise<File> {
  const url = toHttpUrl(input);
  if (!url) throw new Error('That is not a web link this app can open.');

  let response: Response;
  try {
    response = await fetch(url.toString(), { mode: 'cors', credentials: 'omit' });
  } catch {
    throw new Error(
      'That server would not let this app read the file — it sends no cross-origin permission (CORS). Download the video and import it as a file instead.',
    );
  }

  if (!response.ok) {
    throw new Error(`That link could not be fetched — the server answered ${response.status}.`);
  }

  const blob = await response.blob();

  // An HTML page is what you get from a watch/share page rather than a file, and
  // the probe that follows would only report "no readable duration" instead.
  if (blob.type.startsWith('text/') || blob.type.includes('html')) {
    throw new Error(
      'That link is a web page, not a video file. Paste a direct link to the file itself, one that usually ends in .mp4, .webm or .mov.',
    );
  }

  if (blob.size === 0) throw new Error('That link returned an empty file.');

  return new File([blob], nameFromUrl(url), { type: blob.type || 'video/mp4' });
}
