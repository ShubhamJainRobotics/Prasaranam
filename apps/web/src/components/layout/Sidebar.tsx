import React from 'react';
import { NavLink, useLocation, useParams } from 'react-router-dom';
import { OrganisationSwitcher, type OrgSummary } from '../organisation/OrganisationSwitcher.js';
import { ProjectSwitcher, type ProjectSummary } from '../project/ProjectSwitcher.js';

export interface SidebarProps {
  organisations: OrgSummary[];
  currentOrgId?: string;
  projects: ProjectSummary[];
  currentProjectId?: string;
  onOrgCreated?: (org: OrgSummary) => void;
  onProjectCreated?: (proj: ProjectSummary) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  organisations,
  currentOrgId,
  projects,
  currentProjectId,
  onOrgCreated,
  onProjectCreated,
}) => {
  const location = useLocation();
  const params = useParams();

  const orgId = currentOrgId || params.organisationId;
  const projectId = currentProjectId || params.projectId;

  const isProjectView = location.pathname.startsWith('/app/projects/');
  const isOrgView = location.pathname.startsWith('/app/organisations/');

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
      isActive
        ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-semibold'
        : 'text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
    }`;

  return (
    <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col min-h-[calc(100vh-3.5rem)] p-4">
      <div className="space-y-4 mb-6">
        <OrganisationSwitcher
          organisations={organisations}
          currentOrgId={orgId}
          onOrgCreated={onOrgCreated}
        />

        {orgId && (
          <ProjectSwitcher
            orgId={orgId}
            projects={projects}
            currentProjectId={projectId}
            onProjectCreated={onProjectCreated}
          />
        )}
      </div>

      <nav className="flex-1 space-y-1">
        {isProjectView && projectId && (
          <div className="space-y-1">
            <div className="px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Project
            </div>
            <NavLink to={`/app/projects/${projectId}`} end className={linkClass}>
              Dashboard
            </NavLink>
            <NavLink to={`/app/projects/${projectId}/sources`} className={linkClass}>
              Sources
            </NavLink>
            <NavLink to={`/app/projects/${projectId}/knowledge`} className={linkClass}>
              Knowledge Base
            </NavLink>
            <NavLink to={`/app/projects/${projectId}/questions`} className={linkClass}>
              Clarifications
            </NavLink>
            <NavLink to={`/app/projects/${projectId}/handovers`} className={linkClass}>
              Handovers
            </NavLink>
            <NavLink to={`/app/projects/${projectId}/ask`} className={linkClass}>
              Ask Prasaranam
            </NavLink>
            <NavLink to={`/app/projects/${projectId}/members`} className={linkClass}>
              Members
            </NavLink>
            <NavLink to={`/app/projects/${projectId}/settings`} className={linkClass}>
              Settings
            </NavLink>
          </div>
        )}

        {(isOrgView || (!isProjectView && orgId)) && orgId && (
          <div className="space-y-1">
            <div className="px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Organisation
            </div>
            <NavLink to={`/app/organisations/${orgId}`} end className={linkClass}>
              Overview & Projects
            </NavLink>
            <NavLink to={`/app/organisations/${orgId}/members`} className={linkClass}>
              Members
            </NavLink>
          </div>
        )}

        <div className="pt-6 mt-6 border-t border-[var(--color-border)]">
          <NavLink to="/app/settings" className={linkClass}>
            Account Settings
          </NavLink>
        </div>
      </nav>
    </aside>
  );
};
