import React, { useEffect, useState, useCallback } from 'react';
import { Outlet, useLocation, useParams, useNavigate } from 'react-router-dom';
import { Topbar } from './Topbar.js';
import { Sidebar } from './Sidebar.js';
import { DemoModeBanner } from './DemoModeBanner.js';
import { apiFetch } from '../../lib/api.js';
import { LoadingSkeleton } from '../ui/LoadingSkeleton.js';
import type { OrgSummary } from '../organisation/OrganisationSwitcher.js';
import type { ProjectSummary } from '../project/ProjectSwitcher.js';

interface MeResponse {
  id: string;
  email: string;
  displayName: string | null;
  organisations: OrgSummary[];
  projects: Array<{
    id: string;
    organisationId: string;
    name: string;
    domain: string;
    role: string;
  }>;
}

export const AppShell: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [organisations, setOrganisations] = useState<OrgSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();

  const orgId = params.organisationId;
  const projectId = params.projectId;

  const loadUserData = useCallback(async () => {
    try {
      const me = await apiFetch<MeResponse>('/me');
      setOrganisations(me.organisations || []);

      // If we are viewing an organisation, load projects for this organisation
      if (orgId) {
        try {
          const orgProjects = await apiFetch<ProjectSummary[]>(`/organisations/${orgId}/projects`);
          setProjects(orgProjects || []);
        } catch {
          setProjects([]);
        }
      } else if (projectId) {
        // Find which org this project belongs to
        const found = (me.projects || []).find((p) => p.id === projectId);
        if (found) {
          try {
            const orgProjects = await apiFetch<ProjectSummary[]>(
              `/organisations/${found.organisationId}/projects`
            );
            setProjects(orgProjects || []);
          } catch {
            setProjects([]);
          }
        }
      } else {
        setProjects(
          (me.projects || []).map((p) => ({
            id: p.id,
            name: p.name,
            domain: p.domain,
          }))
        );
      }
    } catch {
      // Handled
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData, location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
        <header className="h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 flex items-center justify-between">
          <div className="h-6 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-8 w-8 bg-slate-200 rounded-full animate-pulse" />
        </header>
        <div className="flex flex-1 p-6">
          <div className="w-64 mr-6">
            <LoadingSkeleton lines={6} />
          </div>
          <div className="flex-1">
            <LoadingSkeleton lines={8} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col text-[var(--color-text)]">
      <DemoModeBanner />
      <Topbar />
      <div className="flex flex-1">
        <Sidebar
          organisations={organisations}
          currentOrgId={orgId}
          projects={projects}
          currentProjectId={projectId}
          onOrgCreated={(newOrg) => {
            setOrganisations((prev) => [...prev, newOrg]);
            navigate(`/app/organisations/${newOrg.id}`);
          }}
          onProjectCreated={(newProj) => {
            setProjects((prev) => [...prev, newProj]);
            navigate(`/app/projects/${newProj.id}`);
          }}
        />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
