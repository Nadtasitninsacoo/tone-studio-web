'use client';

import { Download, HardDrive, ListMusic, Music2, Trash2 } from 'lucide-react';

import { Chip, Panel } from '@/components/ui/Panel';
import { formatBytes, formatClock, formatDuration, formatStamp } from '@/lib/format';
import type { Take } from '@/types/recorder';

interface TakeListProps {
  takes: Take[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * TakeList — session history.
 *
 * A semantic table (rather than a div grid) so the timestamp / duration / size
 * columns are readable to assistive tech and can be sorted later without
 * restructuring. On phones the metadata columns collapse into a second line under
 * the filename, and the row actions stay permanently visible — there is no hover
 * on touch, so hover-reveal would hide them entirely.
 */
export function TakeList({ takes, selectedId, onSelect, onDelete }: TakeListProps) {
  const totalBytes = takes.reduce((sum, take) => sum + take.sizeBytes, 0);
  const totalSeconds = takes.reduce((sum, take) => sum + take.durationSec, 0);

  return (
    <Panel
      title="Track History"
      icon={<ListMusic aria-hidden className="h-3.5 w-3.5" />}
      flush
      actions={
        <>
          <Chip tone={takes.length ? 'strong' : 'muted'}>
            {takes.length} {takes.length === 1 ? 'take' : 'takes'}
          </Chip>
          <Chip tone="muted" title="Total size held in memory">
            <HardDrive aria-hidden className="h-2.5 w-2.5" />
            {formatBytes(totalBytes)}
          </Chip>
        </>
      }
    >
      {takes.length === 0 ? (
        <div className="flex h-full min-h-44 flex-col items-center justify-center gap-2 p-6 text-center sm:min-h-52">
          <Music2 aria-hidden className="h-8 w-8 text-ink-3 opacity-50" />
          <p className="text-sm text-ink-2">No takes in this session</p>
          <p className="max-w-xs text-xs text-ink-3">
            Recorded takes are listed here with their timestamp, length and file size.
          </p>
        </div>
      ) : (
        <div className="max-h-88 overflow-y-auto sm:max-h-104">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-solid/95 backdrop-blur">
              <tr className="border-b border-line font-mono text-[10px] tracking-[0.14em] uppercase text-ink-3">
                <th scope="col" className="px-3 py-2 font-semibold sm:px-4">
                  Take
                </th>
                <th scope="col" className="hidden px-2 py-2 font-semibold sm:table-cell">
                  Time
                </th>
                <th scope="col" className="hidden px-2 py-2 text-right font-semibold sm:table-cell">
                  Length
                </th>
                <th scope="col" className="hidden px-2 py-2 text-right font-semibold md:table-cell">
                  Size
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold sm:px-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {takes.map((take, index) => {
                const isSelected = take.id === selectedId;
                return (
                  <tr
                    key={take.id}
                    onClick={() => onSelect(take.id)}
                    aria-selected={isSelected}
                    // Stagger keeps a burst of takes from all appearing at once.
                    style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                    className={`group animate-rise-in cursor-pointer border-b border-line transition-colors duration-200 ${
                      isSelected ? 'bg-cyan/8' : 'hover:bg-raised'
                    }`}
                  >
                    {/* Name, index marker, and (on mobile) the collapsed metadata */}
                    <td className="max-w-0 px-3 py-2.5 sm:px-4">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold transition-colors duration-200 ${
                            isSelected
                              ? 'bg-cyan/15 text-cyan'
                              : 'bg-raised text-ink-3 group-hover:text-ink-2'
                          }`}
                        >
                          {takes.length - index}
                        </span>

                        <span className="min-w-0">
                          <span className="block truncate font-mono text-xs text-ink">
                            {take.name}
                          </span>
                          {/* Phones: fold Time / Length / Size into one line */}
                          <span className="block truncate font-mono text-[10px] text-ink-3 sm:hidden">
                            {formatClock(take.createdAt)} · {formatDuration(take.durationSec)} ·{' '}
                            {formatBytes(take.sizeBytes)}
                          </span>
                          <span className="hidden truncate text-[10px] text-ink-3 sm:block">
                            {take.deviceLabel}
                          </span>
                        </span>
                      </div>
                    </td>

                    {/* Timestamp — full stamp in the tooltip */}
                    <td
                      className="hidden px-2 py-2.5 font-mono text-xs whitespace-nowrap text-ink-2 sm:table-cell"
                      title={formatStamp(take.createdAt)}
                    >
                      {formatClock(take.createdAt)}
                    </td>

                    <td className="hidden px-2 py-2.5 text-right font-numeric text-xs whitespace-nowrap text-ink-2 sm:table-cell">
                      {formatDuration(take.durationSec)}
                    </td>

                    <td className="hidden px-2 py-2.5 text-right font-numeric text-xs whitespace-nowrap text-ink-2 md:table-cell">
                      {formatBytes(take.sizeBytes)}
                    </td>

                    {/* Row actions: always visible on touch, hover-revealed on desktop */}
                    <td className="px-2 py-2.5 sm:px-4">
                      <div className="flex items-center justify-end gap-0.5 transition-opacity duration-200 sm:gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        <a
                          href={take.downloadUrl}
                          download={take.name}
                          onClick={(event) => event.stopPropagation()}
                          title="Download WAV"
                          aria-label={`Download ${take.name}`}
                          className="rounded p-2 text-ink-3 transition-colors duration-150 hover:bg-cyan/12 hover:text-cyan sm:p-1.5"
                        >
                          <Download aria-hidden className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDelete(take.id);
                          }}
                          title="Delete take"
                          aria-label={`Delete ${take.name}`}
                          className="rounded p-2 text-ink-3 transition-colors duration-150 hover:bg-rec/8 hover:text-rec sm:p-1.5"
                        >
                          <Trash2 aria-hidden className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Session totals */}
          <div className="flex items-center justify-between border-t border-line bg-raised/50 px-3 py-2 font-mono text-[10px] tracking-wider uppercase text-ink-3 sm:px-4">
            <span>Session total</span>
            <span className="font-numeric">
              {formatDuration(totalSeconds)} · {formatBytes(totalBytes)}
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}
