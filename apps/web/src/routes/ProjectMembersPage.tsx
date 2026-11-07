import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, RelayApiError } from '../lib/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import {
  ProjectMembersTable,
  type ProjectMemberRow,
} from '../components/project/ProjectMembersTable.js';
import { AddProjectMemberDialog } from '../components/project/AddProjectMemberDialog.js';
import { useAuth } from '../context/AuthContext.js';
import { NotFoundPage } from './NotFoundPage.js';

interface ProjectInfo {
  id: string;
  name: string;
  organisationId: string;
  role?: string;
  currentUserRole?: string;
}

export const ProjectMembersPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [callerRole, setCallerRole] = useState<string>('viewer');
  const [isAddOpen, setIsAddOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const proj = await apiFetch<ProjectInfo>(`/projects/${projectId}`);
      setProject(proj);
      setCallerRole(proj.role || proj.currentUserRole || 'viewer');

      const memberList = await apiFetch<ProjectMemberRow[]>(`/projects/${projectId}/members`);
      setMembers(memberList || []);
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

  const canManage = callerRole === 'owner' || callerRole === 'admin';

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Organisations', href: '/app' },
          { label: 'Organisation', href: `/app/organisations/${project.organisationId}` },
          { label: project.name, href: `/app/projects/${project.id}` },
          { label: 'Members' },
        ]}
      />

      <PageHeader
        title={`${project.name} Members`}
        description="Manage members and role permissions for this project."
        actions={
          canManage ? (
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm"
            >
              + Add Member
            </button>
          ) : undefined
        }
      />

      <ProjectMembersTable
        projectId={project.id}
        members={members}
        canManage={canManage}
        currentUserId={user?.id}
        onRefresh={loadData}
      />

      <AddProjectMemberDialog
        projectId={project.id}
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onMemberAdded={loadData}
      />
    </div>
  );
};
