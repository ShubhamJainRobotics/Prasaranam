import React, { useMemo } from 'react';
import type { SourceDetail, SourceChunk } from '@relay/contracts';
import { SourceAccessBadge } from './SourceAccessBadge.js';

export interface SourceViewerProps {
  source: SourceDetail;
  selectedChunk: SourceChunk | null;
}

export const SourceViewer: React.FC<SourceViewerProps> = ({ source, selectedChunk }) => {
  // Safe code-point based highlight rendering without raw HTML
  const renderedContent = useMemo(() => {
    const rawContent = source.content || '';
    if (!selectedChunk) {
      return <span>{rawContent}</span>;
    }

    const { startOffset, endOffset } = selectedChunk;
    const points = [...rawContent];

    if (startOffset < 0 || endOffset > points.length || startOffset >= endOffset) {
      return <span>{rawContent}</span>;
    }

    const pre = points.slice(0, startOffset).join('');
    const highlighted = points.slice(startOffset, endOffset).join('');
    const post = points.slice(endOffset).join('');

    return (
      <>
        <span>{pre}</span>
        <mark
          className="bg-amber-200 text-amber-950 font-semibold px-0.5 rounded transition-colors"
          title={`Chunk #${selectedChunk.ordinal} [${startOffset}..${endOffset}]`}
        >
          {highlighted}
        </mark>
        <span>{post}</span>
      </>
    );
  }, [source.content, selectedChunk]);

  const totalCodePoints = useMemo(() => {
    return [...(source.content || '')].length;
  }, [source.content]);

  return (
    <div className="space-y-4">
      {/* Metadata Card */}
      <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-[var(--color-text)]">{source.title}</h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 font-mono">
              ID: {source.id} • Lineage: {source.lineageId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-text)]">
              {source.kind}
            </span>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-text)]">
              v{source.revision}
            </span>
            <SourceAccessBadge visibility={source.visibility} grantsCount={source.grants?.length} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-3 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
          {source.authorLabel && (
            <div>
              <span className="font-medium text-[var(--color-text)] block">Author</span>
              <span>{source.authorLabel}</span>
            </div>
          )}
          {source.eventAt && (
            <div>
              <span className="font-medium text-[var(--color-text)] block">Event Date</span>
              <span>{new Date(source.eventAt).toLocaleString()}</span>
            </div>
          )}
          <div>
            <span className="font-medium text-[var(--color-text)] block">Processing Status</span>
            <span className="capitalize">{source.processingStatus}</span>
          </div>
          <div>
            <span className="font-medium text-[var(--color-text)] block">Imported On</span>
            <span>{new Date(source.createdAt).toLocaleString()}</span>
          </div>
        </div>

        {source.originalUrl && (
          <div className="pt-2 border-t border-[var(--color-border)] text-xs">
            <span className="font-medium text-[var(--color-text)] mr-2">Reference URL:</span>
            <span className="font-mono text-[var(--color-text-muted)] select-all break-all">
              {source.originalUrl}
            </span>
            <span className="ml-2 text-[10px] text-slate-500 italic">
              (Metadata only; never fetched)
            </span>
          </div>
        )}

        <div className="pt-1 text-[11px] text-[var(--color-text-muted)] font-mono truncate">
          SHA-256: {source.contentSha256}
        </div>
      </div>

      {/* Canonical Content Viewer */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="p-3 bg-[var(--color-surface-hover)] border-b border-[var(--color-border)] flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Canonical Content
          </span>
          <span className="text-xs font-mono text-[var(--color-text-muted)]">
            {totalCodePoints.toLocaleString()} Unicode code points
          </span>
        </div>

        <div className="p-4 max-h-[700px] overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--color-text)] select-text">
            {renderedContent}
          </pre>
        </div>
      </div>
    </div>
  );
};
