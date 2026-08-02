'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteRecording,
  isApiConfigured,
  listRecordings,
  recordingDownloadUrl,
  recordingStreamUrl,
  uploadRecording,
  type RemoteRecordingMeta,
} from '@/lib/api';
import type { Take } from '@/types/recorder';

/** Build a Take from server metadata. No local blob — audio streams from the API. */
function fromRemote(meta: RemoteRecordingMeta): Take {
  return {
    id: meta.id,
    remoteId: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    durationSec: meta.durationSec,
    sizeBytes: meta.sizeBytes,
    sampleRate: meta.sampleRate,
    channels: meta.channels,
    peakDb: meta.peakDb,
    // The list endpoint omits envelopes to stay small; the player falls back to a
    // flat waveform, and the detail endpoint can fill it in when needed.
    peaks: [],
    url: recordingStreamUrl(meta.id),
    downloadUrl: recordingDownloadUrl(meta.id),
    deviceLabel: meta.deviceLabel,
    sync: 'synced',
  };
}

/**
 * useTakeLibrary — owns the take list and its persistence.
 *
 * Split out of the dashboard so the recording engine stays unaware of the server:
 * `useRecorder` produces a local Take, this hook decides what happens to it.
 *
 * Upload is optimistic. A take appears in the list the instant it is captured and
 * is playable from its local blob; the sync badge reports whether it also reached
 * the server. Losing the network must never lose the take.
 */
export function useTakeLibrary() {
  const [takes, setTakes] = useState<Take[]>([]);
  const [isLoading, setIsLoading] = useState(isApiConfigured);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  /** Object URLs we created and must revoke. Server URLs must not be revoked. */
  const ownedUrls = useRef(new Set<string>());

  const trackUrl = useCallback((take: Take) => {
    if (take.blob) ownedUrls.current.add(take.url);
  }, []);

  const releaseUrl = useCallback((take: Take) => {
    if (ownedUrls.current.delete(take.url)) URL.revokeObjectURL(take.url);
  }, []);

  /** Push a captured take to the server, updating its sync state as it goes. */
  const upload = useCallback(async (take: Take) => {
    if (!isApiConfigured || !take.blob) return;

    setTakes((current) =>
      current.map((entry) => (entry.id === take.id ? { ...entry, sync: 'uploading' } : entry)),
    );

    try {
      const saved = await uploadRecording(take);
      setTakes((current) =>
        current.map((entry) =>
          entry.id === take.id
            ? // Keep the local blob and object URL: playback stays instant and
              // offline, while `remoteId` records that the server also has it.
              { ...entry, remoteId: saved.id, sync: 'synced' }
            : entry,
        ),
      );
    } catch (cause) {
      setTakes((current) =>
        current.map((entry) => (entry.id === take.id ? { ...entry, sync: 'failed' } : entry)),
      );
      setLibraryError(cause instanceof Error ? cause.message : 'Upload failed.');
    }
  }, []);

  /** Add a freshly captured take and begin persisting it. */
  const add = useCallback(
    (take: Take) => {
      trackUrl(take);
      setTakes((current) => [take, ...current]);
      void upload(take);
    },
    [trackUrl, upload],
  );

  /** Retry a failed upload. */
  const retry = useCallback(
    (id: string) => {
      setTakes((current) => {
        const target = current.find((entry) => entry.id === id);
        if (target) void upload(target);
        return current;
      });
    },
    [upload],
  );

  /** Remove a take locally and, if it was persisted, on the server too. */
  const remove = useCallback(
    async (id: string) => {
      let removed: Take | undefined;

      setTakes((current) => {
        removed = current.find((entry) => entry.id === id);
        return current.filter((entry) => entry.id !== id);
      });

      if (!removed) return;
      releaseUrl(removed);

      if (removed.remoteId) {
        try {
          await deleteRecording(removed.remoteId);
        } catch (cause) {
          // The take is already gone from the UI; surface the server failure but
          // do not resurrect the row — that would be more confusing than a toast.
          setLibraryError(
            cause instanceof Error ? cause.message : 'Could not delete on the server.',
          );
        }
      }
    },
    [releaseUrl],
  );

  // Load persisted takes once on mount.
  useEffect(() => {
    if (!isApiConfigured) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const remote = await listRecordings(controller.signal);
        if (controller.signal.aborted) return;

        // Merge rather than replace: a take captured while this request was in
        // flight must not be dropped.
        setTakes((current) => {
          const known = new Set(current.map((entry) => entry.remoteId ?? entry.id));
          const loaded = remote.filter((meta) => !known.has(meta.id)).map(fromRemote);
          return [...current, ...loaded].sort((a, b) => b.createdAt - a.createdAt);
        });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLibraryError(
          cause instanceof Error
            ? `${cause.message} — takes will stay session-local.`
            : 'Could not reach the API.',
        );
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  // Release every object URL we own when the app unmounts.
  useEffect(() => {
    const owned = ownedUrls.current;
    return () => {
      owned.forEach((url) => URL.revokeObjectURL(url));
      owned.clear();
    };
  }, []);

  return {
    takes,
    isLoading,
    libraryError,
    add,
    remove,
    retry,
    clearLibraryError: useCallback(() => setLibraryError(null), []),
    isPersistenceEnabled: isApiConfigured,
  };
}
