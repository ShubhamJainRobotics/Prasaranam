import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { SourceDetail, SourceChunk } from '@relay/contracts';
import { apiFetch, RelayApiError } from '../lib/api.js';
import { SourceViewer } from '../components/sources/SourceViewer.js';
import { ChunkHighlighter } from '../components/sources/ChunkHighlighter.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ErrorState } from '../components/ui/ErrorState.js';

export const SourceDetailPage: React.FC = () => {
  const { projectId, sourceId } = useParams<{ projectId: string; sourceId: string }>();

  const [source, setSource] = useState<SourceDetail | null>(null);
  const [chunks, setChunks] = useState<SourceChunk[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<SourceChunk | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSourceAndChunks = useCallback(async () => {
    if (!sourceId) return;
    setIsLoading(true);
    setError(null);

    try {
      const [sourceData, chunksData] = await Promise.all([
        apiFetch<SourceDetail>(`/sources/${sourceId}`),
        apiFetch<SourceChunk[]>(`/sources/${sourceId}/chunks`),
      ]);

      setSource(sourceData);
      setChunks(chunksData || []);
    } catch (err: any) {
      if (err instanceof RelayApiError && err.status === 404) {
        setError('Source not found or you lack permission to view this content.');
      } else {
        setError(err.message || 'Error loading source');
      }
    } finally {
      setIsLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    fetchSourceAndChunks();
  }, [fetchSourceAndChunks]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <LoadingSkeleton className="h-6 w-32" />
        <LoadingSkeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <LoadingSkeleton className="h-96 w-full" />
          </div>
          <div>
            <LoadingSkeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <ErrorState
          message={error || 'Source could not be found.'}
          onRetry={fetchSourceAndChunks}
        />
        <div className="mt-4 text-center">
          <Link
            to={`/app/projects/${projectId}/sources`}
            className="text-xs text-[var(--color-primary)] hover:underline font-medium"
          >
            ← Back to Project Sources
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      {/* Navigation */}
      <nav className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5 pb-2 border-b border-[var(--color-border)]">
        <Link to={`/app/projects/${projectId}`} className="hover:underline">
          Project
        </Link>
        <span>/</span>
        <Link to={`/app/projects/${projectId}/sources`} className="hover:underline">
          Sources
        </Link>
        <span>/</span>
        <span className="text-[var(--color-text)] font-medium truncate max-w-xs">
          {source.title}
        </span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Source Viewer (2 cols) */}
        <div className="lg:col-span-2">
          <SourceViewer source={source} selectedChunk={selectedChunk} />
        </div>

        {/* Chunks Inspector (1 col) */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 sticky top-6">
          <ChunkHighlighter
            chunks={chunks}
            selectedChunkOrdinal={selectedChunk?.ordinal ?? null}
            onSelectChunk={(c) => setSelectedChunk(c)}
          />
        </div>
      </div>
    </div>
  );
};
