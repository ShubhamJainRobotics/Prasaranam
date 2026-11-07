import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorState } from '../components/ui/ErrorState.js';
import { KnowledgeFilters } from '../components/knowledge/KnowledgeFilters.js';
import { ClaimCard } from '../components/knowledge/ClaimCard.js';
import { ClaimDetailPanel } from '../components/knowledge/ClaimDetailPanel.js';
import { EvidenceDrawer } from '../components/knowledge/EvidenceDrawer.js';
import { ClaimFlagDialog } from '../components/knowledge/ClaimFlagDialog.js';
import { OwnerLinkDialog } from '../components/knowledge/OwnerLinkDialog.js';
import { JobProgressPanel } from '../components/knowledge/JobProgressPanel.js';
import { ConflictPanel } from '../components/knowledge/ConflictPanel.js';
import { DecisionTimeline } from '../components/knowledge/DecisionTimeline.js';
import { DependencyList } from '../components/knowledge/DependencyList.js';
import { apiFetch, apiFetchPaginated } from '../lib/api.js';
import { useToast } from '../context/ToastContext.js';
import type {
  ClaimSummary,
  ClaimDetail,
  JobSummary,
  ClaimCategory,
  WorkState,
  EvidenceState,
  ReviewState,
} from '@relay/contracts';

export const ProjectKnowledgePage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'claims' | 'timeline' | 'dependencies'>('claims');

  // Filter states
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ClaimCategory | undefined>();
  const [workState, setWorkState] = useState<WorkState | undefined>();
  const [evidenceState, setEvidenceState] = useState<EvidenceState | undefined>();
  const [reviewState, setReviewState] = useState<ReviewState | undefined>();

  // Data states
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Modal / Drawer states
  const [selectedClaim, setSelectedClaim] = useState<ClaimDetail | null>(null);
  const [drawerClaim, setDrawerClaim] = useState<ClaimSummary | ClaimDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [flaggingClaim, setFlaggingClaim] = useState<ClaimSummary | null>(null);
  const [linkingClaim, setLinkingClaim] = useState<ClaimSummary | null>(null);

  // Triggering actions
  const [triggeringExtract, setTriggeringExtract] = useState(false);

  const fetchClaims = useCallback(
    async (cursor?: string) => {
      if (!projectId) return;
      try {
        const queryParams = new URLSearchParams();
        if (cursor) queryParams.set('cursor', cursor);
        if (search) queryParams.set('search', search);
        if (kind) queryParams.set('kind', kind);
        if (workState) queryParams.set('workState', workState);
        if (evidenceState) queryParams.set('evidenceState', evidenceState);
        if (reviewState) queryParams.set('reviewState', reviewState);

        const url = `/projects/${projectId}/claims?${queryParams.toString()}`;
        const res = await apiFetchPaginated<ClaimSummary[]>(url);

        if (cursor) {
          setClaims((prev) => [...prev, ...res.data]);
        } else {
          setClaims(res.data);
        }

        setNextCursor(res.page?.nextCursor || null);
        setHasMore(Boolean(res.page?.hasMore));
      } catch (err: any) {
        setError(err.message || 'Failed to load claims');
      }
    },
    [projectId, search, kind, workState, evidenceState, reviewState]
  );

  const fetchJobs = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await apiFetch<JobSummary[]>(`/projects/${projectId}/jobs`);
      setJobs(data);
    } catch {
      // Non-critical, safe to swallow
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchClaims(), fetchJobs()]).finally(() => {
      setLoading(false);
    });
  }, [fetchClaims, fetchJobs]);

  useEffect(() => {
    const hasActiveJobs = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasActiveJobs) return;

    const timer = setInterval(() => {
      fetchJobs();
      fetchClaims();
    }, 1000);

    return () => clearInterval(timer);
  }, [jobs, fetchJobs, fetchClaims]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchClaims(nextCursor);
    setLoadingMore(false);
  };

  const handleSelectClaim = async (claim: ClaimSummary) => {
    try {
      const detail = await apiFetch<ClaimDetail>(`/claims/${claim.id}`);
      setSelectedClaim(detail);
      setIsDetailOpen(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to load claim details', 'error');
    }
  };

  const handleViewEvidence = async (claim: ClaimSummary) => {
    try {
      const detail = await apiFetch<ClaimDetail>(`/claims/${claim.id}`);
      setDrawerClaim(detail);
      setIsDrawerOpen(true);
    } catch {
      setDrawerClaim(claim);
      setIsDrawerOpen(true);
    }
  };

  const handleTriggerExtraction = async () => {
    if (!projectId) return;
    try {
      setTriggeringExtract(true);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/projects/${projectId}/extractions`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({}),
      });

      showToast('Extraction job enqueued successfully', 'success');
      fetchJobs();
    } catch (err: any) {
      showToast(err.message || 'Failed to enqueue extraction', 'error');
    } finally {
      setTriggeringExtract(false);
    }
  };

  const handleReviewClaim = async (claimId: string, newState: 'approved' | 'rejected') => {
    try {
      await apiFetch(`/claims/${claimId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewState: newState }),
      });

      showToast(`Claim marked as ${newState}`, 'success');

      setClaims((prev) =>
        prev.map((c) => (c.id === claimId ? { ...c, reviewState: newState } : c))
      );
      if (selectedClaim && selectedClaim.id === claimId) {
        setSelectedClaim({ ...selectedClaim, reviewState: newState });
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to update review state', 'error');
    }
  };

  const handleLinkOwner = async (claimId: string, userId: string | null) => {
    await apiFetch(`/claims/${claimId}/owner`, {
      method: 'PATCH',
      body: JSON.stringify({ userId }),
    });

    showToast(userId ? 'Owner linked successfully' : 'Owner unlinked', 'success');

    fetchClaims();
    if (selectedClaim && selectedClaim.id === claimId) {
      const updated = await apiFetch<ClaimDetail>(`/claims/${claimId}`);
      setSelectedClaim(updated);
    }
  };

  const handleFlagClaim = async (
    claimId: string,
    reason: string,
    newEvidenceState: 'needs_confirmation' | 'conflicting'
  ) => {
    await apiFetch(`/claims/${claimId}/flags`, {
      method: 'POST',
      body: JSON.stringify({ reason, newEvidenceState }),
    });

    showToast('Claim flagged successfully', 'success');

    fetchClaims();
    if (selectedClaim && selectedClaim.id === claimId) {
      const updated = await apiFetch<ClaimDetail>(`/claims/${claimId}`);
      setSelectedClaim(updated);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await apiFetch(`/jobs/${jobId}/retry`, { method: 'POST' });
      showToast('Job retry requested', 'success');
      fetchJobs();
    } catch (err: any) {
      showToast(err.message || 'Failed to retry job', 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton lines={4} />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => fetchClaims()} />;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/app' },
          { label: 'Dashboard', href: `/app/projects/${projectId}` },
          { label: 'Knowledge Base' },
        ]}
      />

      <PageHeader
        title="Project Knowledge Base"
        description="Evidence-backed claims, decisions, and tasks reconstructed from project sources."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/app/projects/${projectId}/questions`)}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors"
            >
              Clarification Questions
            </button>
            <button
              type="button"
              onClick={handleTriggerExtraction}
              disabled={triggeringExtract}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded shadow-xs transition-colors disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span>{triggeringExtract ? 'Enqueueing...' : 'Run Extraction'}</span>
            </button>
          </div>
        }
      />

      {/* Active Jobs Progress Panel */}
      <JobProgressPanel jobs={jobs} onRetry={handleRetryJob} onRefresh={fetchJobs} />

      {/* Conflicts Banner Panel */}
      <ConflictPanel
        claims={claims}
        onSelectClaim={handleSelectClaim}
        onNavigateQuestions={() => navigate(`/app/projects/${projectId}/questions`)}
      />

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-6 text-sm font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('claims')}
          className={`pb-3 -mb-px flex items-center gap-2 ${
            activeTab === 'claims'
              ? 'border-b-2 border-teal-700 text-teal-900 font-semibold'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>All Claims</span>
          <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 text-xs">
            {claims.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('timeline')}
          className={`pb-3 -mb-px flex items-center gap-2 ${
            activeTab === 'timeline'
              ? 'border-b-2 border-teal-700 text-teal-900 font-semibold'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>Decisions Timeline</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('dependencies')}
          className={`pb-3 -mb-px flex items-center gap-2 ${
            activeTab === 'dependencies'
              ? 'border-b-2 border-teal-700 text-teal-900 font-semibold'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>Blockers & Dependencies</span>
        </button>
      </div>

      {activeTab === 'claims' && (
        <div className="space-y-4">
          <KnowledgeFilters
            search={search}
            onSearchChange={setSearch}
            kind={kind}
            onKindChange={setKind}
            workState={workState}
            onWorkStateChange={setWorkState}
            evidenceState={evidenceState}
            onEvidenceStateChange={setEvidenceState}
            reviewState={reviewState}
            onReviewStateChange={setReviewState}
            onReset={() => {
              setSearch('');
              setKind(undefined);
              setWorkState(undefined);
              setEvidenceState(undefined);
              setReviewState(undefined);
            }}
          />

          {claims.length === 0 ? (
            <EmptyState
              title="No claims match your filters"
              description="Try adjusting your filter options or run an extraction over imported sources."
              action={{
                label: 'Run Extraction',
                onClick: handleTriggerExtraction,
              }}
            />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3">
                {claims.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    onClick={handleSelectClaim}
                    onViewEvidence={handleViewEvidence}
                  />
                ))}
              </div>

              {hasMore && (
                <div className="text-center pt-4">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 shadow-xs disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading more claims...' : 'Load More Claims'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'timeline' && (
        <DecisionTimeline claims={claims} onSelectClaim={handleSelectClaim} />
      )}

      {activeTab === 'dependencies' && (
        <DependencyList claims={claims} onSelectClaim={handleSelectClaim} />
      )}

      {/* Claim Detail Modal / Slide-over */}
      <ClaimDetailPanel
        claim={selectedClaim}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedClaim(null);
        }}
        onReview={handleReviewClaim}
        onOpenOwnerLink={(claim) => setLinkingClaim(claim)}
        onOpenFlag={(claim) => setFlaggingClaim(claim)}
      />

      {/* Evidence Drawer */}
      <EvidenceDrawer
        claim={drawerClaim}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setDrawerClaim(null);
        }}
      />

      {/* Owner Link Dialog */}
      <OwnerLinkDialog
        claim={linkingClaim}
        projectId={projectId!}
        isOpen={Boolean(linkingClaim)}
        onClose={() => setLinkingClaim(null)}
        onSubmit={handleLinkOwner}
      />

      {/* Claim Flag Dialog */}
      <ClaimFlagDialog
        claim={flaggingClaim}
        isOpen={Boolean(flaggingClaim)}
        onClose={() => setFlaggingClaim(null)}
        onSubmit={handleFlagClaim}
      />
    </div>
  );
};
