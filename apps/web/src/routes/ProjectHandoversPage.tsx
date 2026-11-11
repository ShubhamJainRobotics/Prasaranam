import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorState } from '../components/ui/ErrorState.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import type { HandoverSummary } from '@relay/contracts';

export const ProjectHandoversPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { profile } = useAuth();
  const [handovers, setHandovers] = useState<HandoverSummary[]>([]);
  const [projectName, setProjectName] = useState<string>('Project');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectMember = profile?.projects.find((p) => p.id === projectId);
  const isReviewerOrOwner = projectMember
    ? ['owner', 'reviewer'].includes(projectMember.role)
    : false;

  useEffect(() => {
    if (!projectId) return;

    let mounted = true;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [projRes, handoversRes] = await Promise.all([
          api.get<{ project?: { name: string }; name?: string }>(`/projects/${projectId}`),
          api.get<HandoverSummary[] | { data: HandoverSummary[] }>(
            `/projects/${projectId}/handovers`
          ),
        ]);

        if (mounted) {
          const name = projRes?.project?.name || projRes?.name;
          if (name) {
            setProjectName(name);
          }
          if (Array.isArray(handoversRes)) {
            setHandovers(handoversRes);
          } else if (handoversRes && 'data' in handoversRes && Array.isArray(handoversRes.data)) {
            setHandovers(handoversRes.data);
          }
        }
      } catch (err: unknown) {
        if (mounted) {
          setError((err as Error).message || 'Failed to load project handovers');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <LoadingSkeleton lines={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/app' },
          { label: projectName, href: `/app/projects/${projectId}/dashboard` },
          { label: 'Handovers' },
        ]}
      />

      <PageHeader
        title="Project Handovers"
        description="Evidence-grounded knowledge transfer documents configured for incoming teammates."
        actions={
          isReviewerOrOwner ? (
            <Link
              to={`/app/projects/${projectId}/handovers/new`}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-xl shadow-xs transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New Handover
            </Link>
          ) : undefined
        }
      />

      {handovers.length === 0 ? (
        <EmptyState
          title="No Handovers Yet"
          description={
            isReviewerOrOwner
              ? "Generate a new handover draft tailored to an incoming team member's role and access scope."
              : 'No handovers have been shared with you in this project yet.'
          }
          action={
            isReviewerOrOwner
              ? {
                  label: 'Generate Handover',
                  onClick: () => {
                    window.location.href = `/app/projects/${projectId}/handovers/new`;
                  },
                }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {handovers.map((h) => {
            const isShared = h.status === 'shared';
            const isDraft = h.status === 'draft';
            const isApproved = h.status === 'approved';

            const targetUrl =
              isDraft || isApproved ? `/app/handovers/${h.id}/review` : `/app/handovers/${h.id}`;

            return (
              <div
                key={h.id}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200">
                      v{h.version}
                    </span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase ${
                        isShared
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : isApproved
                            ? 'bg-teal-50 text-teal-800 border border-teal-200'
                            : h.status === 'stale' || h.status === 'superseded'
                              ? 'bg-slate-100 text-slate-600 border border-slate-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {h.status}
                    </span>
                  </div>

                  <h3 className="text-base font-semibold text-slate-900 mb-1">{h.title}</h3>

                  <div className="text-xs text-slate-500 space-y-1 mb-4">
                    <div>
                      Recipient:{' '}
                      <strong className="text-slate-800">
                        {h.recipientName || 'Incoming Member'}
                      </strong>
                    </div>
                    {h.departingUserName && (
                      <div>
                        Departing Member:{' '}
                        <strong className="text-slate-800">{h.departingUserName}</strong>
                      </div>
                    )}
                    {h.itemCount !== undefined && (
                      <div>
                        Items:{' '}
                        <strong className="text-slate-800">{h.itemCount} verified items</strong>
                      </div>
                    )}
                    <div>Created: {new Date(h.createdAt).toLocaleDateString()}</div>
                  </div>

                  {isReviewerOrOwner && (
                    <div className="mb-4">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${
                          h.acknowledgedAt
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {h.acknowledgedAt
                          ? `Acknowledged by recipient on ${new Date(h.acknowledgedAt).toLocaleDateString()}`
                          : 'Not yet acknowledged'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">ID: {h.id.slice(0, 8)}...</span>
                  <Link
                    to={targetUrl}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 group"
                  >
                    <span>{isDraft ? 'Review Draft' : 'Open Handover'}</span>
                    <svg
                      className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
