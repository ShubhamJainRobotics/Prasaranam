import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SourceSummary } from '@relay/contracts';
import { SourceAccessBadge } from './SourceAccessBadge.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';

export interface SourceTableProps {
  projectId: string;
  sources: SourceSummary[];
  isOwner: boolean;
  onEditAccess: (source: SourceSummary) => void;
  onArchive: (source: SourceSummary) => Promise<void>;
}

export const SourceTable: React.FC<SourceTableProps> = ({
  projectId,
  sources,
  isOwner,
  onEditAccess,
  onArchive,
}) => {
  const [sourceToArchive, setSourceToArchive] = useState<SourceSummary | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const confirmArchive = async () => {
    if (!sourceToArchive) return;
    setIsArchiving(true);
    try {
      await onArchive(sourceToArchive);
      setSourceToArchive(null);
    } finally {
      setIsArchiving(false);
    }
  };

  const getKindBadge = (kind: string) => {
    const styleMap: Record<string, string> = {
      text: 'bg-slate-100 text-slate-700',
      markdown: 'bg-blue-50 text-blue-700 border-blue-200',
      messages: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      issues: 'bg-purple-50 text-purple-700 border-purple-200',
      reviewer_context: 'bg-amber-50 text-amber-700 border-amber-200',
    };

    return (
      <span
        className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono uppercase font-medium border border-transparent ${
          styleMap[kind] || 'bg-gray-100 text-gray-700'
        }`}
      >
        {kind}
      </span>
    );
  };

  if (sources.length === 0) {
    return (
      <div className="p-12 text-center border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
        <p className="text-sm font-medium text-[var(--color-text)]">No sources found</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Import documents, messages, or issues to begin knowledge extraction.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs divide-y divide-[var(--color-border)]">
            <thead className="bg-[var(--color-surface-hover)] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Source Title</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Visibility</th>
                <th className="px-4 py-3">Revision</th>
                <th className="px-4 py-3">Chunks</th>
                <th className="px-4 py-3">Imported</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text)]">
              {sources.map((source) => (
                <tr
                  key={source.id}
                  className="hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/app/projects/${projectId}/sources/${source.id}`}
                      className="font-medium text-[var(--color-primary)] hover:underline block max-w-xs truncate"
                      title={source.title}
                    >
                      {source.title}
                    </Link>
                    {source.authorLabel && (
                      <span className="text-[11px] text-[var(--color-text-muted)] block truncate">
                        By {source.authorLabel}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{getKindBadge(source.kind)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <SourceAccessBadge visibility={source.visibility} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px]">
                    v{source.revision}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px]">
                    {source.chunkCount ?? '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-muted)]">
                    {new Date(source.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right space-x-2">
                    <Link
                      to={`/app/projects/${projectId}/sources/${source.id}`}
                      className="text-[var(--color-primary)] hover:underline font-medium"
                    >
                      View
                    </Link>
                    {isOwner && (
                      <>
                        <button
                          type="button"
                          onClick={() => onEditAccess(source)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium"
                        >
                          Access
                        </button>
                        <button
                          type="button"
                          onClick={() => setSourceToArchive(source)}
                          className="text-red-600 hover:text-red-800 font-medium"
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(sourceToArchive)}
        title="Archive Source"
        message={`Are you sure you want to archive "${sourceToArchive?.title}"? Archiving will invalidate handovers derived from this source and increment the project access epoch.`}
        confirmLabel={isArchiving ? 'Archiving...' : 'Archive Source'}
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={confirmArchive}
        onCancel={() => setSourceToArchive(null)}
      />
    </>
  );
};
