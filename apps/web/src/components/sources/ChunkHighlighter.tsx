import React from 'react';
import type { SourceChunk } from '@relay/contracts';

export interface ChunkHighlighterProps {
  chunks: SourceChunk[];
  selectedChunkOrdinal: number | null;
  onSelectChunk: (chunk: SourceChunk | null) => void;
}

export const ChunkHighlighter: React.FC<ChunkHighlighterProps> = ({
  chunks,
  selectedChunkOrdinal,
  onSelectChunk,
}) => {
  if (chunks.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--color-text-muted)] text-center border border-[var(--color-border)] rounded-md">
        No chunks available for this source.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] pb-1 border-b border-[var(--color-border)]">
        <span>Extracted Chunks ({chunks.length})</span>
        {selectedChunkOrdinal !== null && (
          <button
            onClick={() => onSelectChunk(null)}
            className="text-[var(--color-primary)] hover:underline capitalize text-[11px]"
          >
            Clear selection
          </button>
        )}
      </div>

      <div className="max-h-[600px] overflow-y-auto space-y-2 pr-1">
        {chunks.map((chunk) => {
          const isSelected = selectedChunkOrdinal === chunk.ordinal;
          return (
            <div
              key={chunk.id}
              onClick={() => onSelectChunk(isSelected ? null : chunk)}
              className={`p-3 rounded-md border text-xs cursor-pointer transition-all ${
                isSelected
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] ring-1 ring-[var(--color-primary)]'
                  : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] bg-[var(--color-surface)]'
              }`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectChunk(isSelected ? null : chunk);
                }
              }}
            >
              <div className="flex items-center justify-between font-mono text-[11px] text-[var(--color-text-muted)] mb-1">
                <span className="font-semibold text-[var(--color-text)]">
                  Chunk #{chunk.ordinal}
                </span>
                <span>
                  [{chunk.startOffset}..{chunk.endOffset}] ({chunk.endOffset - chunk.startOffset}{' '}
                  cp)
                </span>
              </div>

              {chunk.recordRef && (
                <div className="text-[11px] font-mono text-[var(--color-primary)] mb-1">
                  Ref: {chunk.recordRef}
                </div>
              )}

              <p className="line-clamp-2 text-[var(--color-text-muted)] font-mono text-[11px] leading-relaxed">
                {chunk.content}
              </p>

              {(chunk.authorLabel || chunk.eventAt) && (
                <div className="flex items-center gap-2 mt-2 pt-1 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
                  {chunk.authorLabel && <span>By {chunk.authorLabel}</span>}
                  {chunk.eventAt && <span>{new Date(chunk.eventAt).toLocaleDateString()}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
