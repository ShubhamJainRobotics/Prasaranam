import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { SourceSummary } from '@relay/contracts';
import { apiFetch } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { SourceTable } from '../components/sources/SourceTable.js';
import { ImportWizard } from '../components/sources/ImportWizard.js';
import {
  SourceAccessEditor,
  type ProjectMemberOption,
} from '../components/sources/SourceAccessEditor.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ErrorState } from '../components/ui/ErrorState.js';

export const ProjectSourcesPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberOption[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [sourceForAccessEdit, setSourceForAccessEdit] = useState<SourceSummary | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterKind, setFilterKind] = useState<string>('all');
  const [filterVisibility, setFilterVisibility] = useState<string>('all');

  const fetchSources = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await apiFetch<SourceSummary[]>(`/projects/${projectId}/sources`);
      setSources(res || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading sources');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const fetchProjectInfo = useCallback(async () => {
    if (!projectId) return;
    try {
      const proj = await apiFetch<any>(`/projects/${projectId}`);
      setIsOwner(proj.role === 'owner' || proj.currentUserRole === 'owner');

      const members = await apiFetch<any[]>(`/projects/${projectId}/members`);
      const mapped = (members || []).map((m: any) => ({
        userId: m.userId,
        displayName: m.displayName || 'Unnamed user',
        role: m.role,
      }));
      setProjectMembers(mapped);
    } catch {
      // Non-fatal if member list fails to load
    }
  }, [projectId]);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchSources(), fetchProjectInfo()]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchSources, fetchProjectInfo]);

  const handleArchive = async (source: SourceSummary) => {
    try {
      await apiFetch(`/sources/${source.id}/archive`, { method: 'POST' });
      showToast(`Source "${source.title}" archived successfully.`, 'success');
      fetchSources();
    } catch (err: any) {
      showToast(err.message || 'Failed to archive source', 'error');
    }
  };

  const handleSaveAccess = async (visibility: 'project' | 'restricted', grantUserIds: string[]) => {
    if (!sourceForAccessEdit) return;
    try {
      await apiFetch(`/sources/${sourceForAccessEdit.id}/access`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility, grantUserIds }),
      });
      showToast('Source access policy updated.', 'success');
      fetchSources();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update access policy');
    }
  };

  // Filter sources
  const filteredSources = sources.filter((s) => {
    const matchesSearch =
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.authorLabel && s.authorLabel.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesKind = filterKind === 'all' || s.kind === filterKind;
    const matchesVisibility = filterVisibility === 'all' || s.visibility === filterVisibility;
    return matchesSearch && matchesKind && matchesVisibility;
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <LoadingSkeleton className="h-8 w-48" />
        <LoadingSkeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={fetchSources} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--color-border)]">
        <div>
          <nav className="text-xs text-[var(--color-text-muted)] mb-1 flex items-center gap-1.5">
            <Link to={`/app/projects/${projectId}`} className="hover:underline">
              Project
            </Link>
            <span>/</span>
            <span className="text-[var(--color-text)] font-medium">Sources</span>
          </nav>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Project Sources</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Ingested documents, conversation logs, and issue backlogs with exact evidence chunking.
          </p>
        </div>

        <button
          onClick={() => setIsImportWizardOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--color-primary)] text-white text-xs font-semibold rounded-md hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm"
        >
          <span>＋</span> Import Sources
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-[var(--color-surface)] p-3 border border-[var(--color-border)] rounded-lg text-xs">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            aria-label="Search sources"
            placeholder="Search sources by title or author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="source-format-filter"
            className="text-[var(--color-text-muted)] font-medium"
          >
            Format:
          </label>
          <select
            id="source-format-filter"
            aria-label="Filter by format"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            className="px-2 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text)]"
          >
            <option value="all">All Formats</option>
            <option value="text">Text (.txt)</option>
            <option value="markdown">Markdown (.md)</option>
            <option value="messages">Messages</option>
            <option value="issues">Issues</option>
            <option value="reviewer_context">Reviewer Context</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="source-visibility-filter"
            className="text-[var(--color-text-muted)] font-medium"
          >
            Visibility:
          </label>
          <select
            id="source-visibility-filter"
            aria-label="Filter by visibility"
            value={filterVisibility}
            onChange={(e) => setFilterVisibility(e.target.value)}
            className="px-2 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text)]"
          >
            <option value="all">All Visibility</option>
            <option value="project">Project-wide</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>
      </div>

      {/* Source Table */}
      <SourceTable
        projectId={projectId!}
        sources={filteredSources}
        isOwner={isOwner}
        onEditAccess={(s) => setSourceForAccessEdit(s)}
        onArchive={handleArchive}
      />

      {/* Import Wizard Modal */}
      {projectId && (
        <ImportWizard
          isOpen={isImportWizardOpen}
          onClose={() => setIsImportWizardOpen(false)}
          projectId={projectId}
          currentUserId={user?.id || ''}
          projectMembers={projectMembers}
          onImportCompleted={fetchSources}
        />
      )}

      {/* Source Access Editor Modal */}
      {sourceForAccessEdit && (
        <SourceAccessEditor
          isOpen={Boolean(sourceForAccessEdit)}
          onClose={() => setSourceForAccessEdit(null)}
          source={sourceForAccessEdit}
          projectMembers={projectMembers}
          onSave={handleSaveAccess}
        />
      )}
    </div>
  );
};
