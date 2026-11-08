import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, RelayApiError } from '../lib/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ProjectHealthSummary } from '../components/project/ProjectHealthSummary.js';
import { NotFoundPage } from './NotFoundPage.js';

interface DashboardResponse {
  project: {
    id: string;
    organisationId: string;
    name: string;
    description?: string | null;
    domain: string;
    timezone: string;
    accessEpoch: number;
    createdAt: string;
  };
  memberCount: number;
  counts: {
    sources: number;
    claims: number;
    questions: number;
    handovers: number;
  };
}

export const ProjectDashboardPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await apiFetch<DashboardResponse>(`/projects/${projectId}/dashboard`);
      setDashboard(data);
    } catch (err) {
      if (err instanceof RelayApiError && err.status === 404) {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (notFound) {
    return <NotFoundPage />;
  }

  if (loading || !dashboard) {
    return <LoadingSkeleton lines={8} />;
  }

  const { project, memberCount, counts } = dashboard;

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Organisations', href: '/app' },
          {
            label: 'Organisation',
            href: `/app/organisations/${project.organisationId}`,
          },
          { label: project.name },
        ]}
      />

      <PageHeader
        title={project.name}
        description={project.description || 'Project knowledge base and handover workspace.'}
        actions={
          <div className="flex items-center gap-3">
            <Link
              to={`/app/projects/${project.id}/members`}
              className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Members ({memberCount})
            </Link>
            <Link
              to={`/app/projects/${project.id}/settings`}
              className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Settings
            </Link>
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-[var(--color-primary-subtle)] px-3 py-1 text-xs font-semibold text-[var(--color-primary)] capitalize">
          Domain: {project.domain.replace('_', ' ')}
        </span>
        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          Timezone: {project.timezone}
        </span>
        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          Access Epoch: {project.accessEpoch}
        </span>
      </div>

      <ProjectHealthSummary
        memberCount={memberCount}
        sourceCount={counts.sources}
        claimCount={counts.claims}
        questionCount={counts.questions}
        handoverCount={counts.handovers}
        accessEpoch={project.accessEpoch}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Active Members
          </p>
          <p className="mt-2 text-3xl font-bold text-[var(--color-text)]">{memberCount}</p>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Sources
          </p>
          <p className="mt-2 text-3xl font-bold text-[var(--color-text)]">{counts.sources}</p>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Extracted Claims
          </p>
          <p className="mt-2 text-3xl font-bold text-[var(--color-text)]">{counts.claims}</p>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Handovers
          </p>
          <p className="mt-2 text-3xl font-bold text-[var(--color-text)]">{counts.handovers}</p>
        </div>
      </div>
    </div>
  );
};
