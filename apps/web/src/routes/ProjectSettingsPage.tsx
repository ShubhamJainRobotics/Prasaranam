import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, RelayApiError } from '../lib/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ProjectSettingsForm } from '../components/project/ProjectSettingsForm.js';
import { RoleGate } from '../components/auth/RoleGate.js';
import { NotFoundPage } from './NotFoundPage.js';

interface ProjectDetail {
  id: string;
  name: string;
  description?: string | null;
  domain: string;
  organisationId: string;
  role?: string;
  currentUserRole?: string;
  settings?: {
    retention_days?: number;
    [key: string]: unknown;
  } | null;
}

export const ProjectSettingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [callerRole, setCallerRole] = useState<string>('viewer');

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const proj = await apiFetch<ProjectDetail>(`/projects/${projectId}`);
      setProject(proj);
      setCallerRole(proj.role || proj.currentUserRole || 'viewer');
    } catch (err) {
      if (err instanceof RelayApiError && err.status === 404) {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (notFound) {
    return <NotFoundPage />;
  }

  if (loading || !project) {
    return <LoadingSkeleton lines={8} />;
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Organisations', href: '/app' },
          { label: 'Organisation', href: `/app/organisations/${project.organisationId}` },
          { label: project.name, href: `/app/projects/${project.id}` },
          { label: 'Settings' },
        ]}
      />

      <PageHeader
        title={`${project.name} Settings`}
        description="Configure project properties and retention policies."
      />

      <RoleGate allowedRoles={['owner', 'admin']} userRole={callerRole}>
        <div className="max-w-2xl">
          <ProjectSettingsForm project={project} onUpdated={loadData} />
        </div>
      </RoleGate>
    </div>
  );
};
