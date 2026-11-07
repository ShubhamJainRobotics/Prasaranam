import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiFetch, RelayApiError } from '../lib/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { ProjectCard } from '../components/project/ProjectCard.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { CreateProjectDialog } from '../components/project/CreateProjectDialog.js';
import { NotFoundPage } from './NotFoundPage.js';

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  domain: string;
  description?: string | null;
  createdAt?: string;
}

interface MeResponse {
  organisations: Array<{ id: string; name: string; role: string }>;
}

export const OrganisationOverviewPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [orgName, setOrgName] = useState<string>('Organisation');
  const [orgRole, setOrgRole] = useState<string>('member');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!organisationId) return;
    try {
      // Find org in user's memberships
      const me = await apiFetch<MeResponse>('/me');
      const foundOrg = me.organisations?.find((o) => o.id === organisationId);
      if (!foundOrg) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setOrgName(foundOrg.name);
      setOrgRole(foundOrg.role);

      const projs = await apiFetch<ProjectItem[]>(`/organisations/${organisationId}/projects`);
      setProjects(projs || []);
    } catch (err) {
      if (err instanceof RelayApiError && err.status === 404) {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [organisationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (notFound) {
    return <NotFoundPage />;
  }

  if (loading) {
    return <LoadingSkeleton lines={8} />;
  }

  const canCreateProject = orgRole === 'owner' || orgRole === 'admin';

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Organisations', href: '/app' }, { label: orgName }]} />

      <PageHeader
        title={orgName}
        description="Organisation overview and active projects."
        actions={
          <div className="flex items-center gap-3">
            <Link
              to={`/app/organisations/${organisationId}/members`}
              className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Manage Members
            </Link>
            {canCreateProject && (
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm"
              >
                + New Project
              </button>
            )}
          </div>
        }
      />

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            Projects ({projects.length})
          </h2>
        </div>

        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create your first project to start organizing documents, extracting claims, and generating handovers."
            action={
              canCreateProject
                ? {
                    label: 'Create Project',
                    onClick: () => setIsCreateOpen(true),
                  }
                : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((proj) => (
              <ProjectCard key={proj.id} project={proj} />
            ))}
          </div>
        )}
      </section>

      {organisationId && (
        <CreateProjectDialog
          orgId={organisationId}
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onCreated={(createdProject) => {
            loadData();
            navigate(`/app/projects/${createdProject.id}`);
          }}
        />
      )}
    </div>
  );
};
