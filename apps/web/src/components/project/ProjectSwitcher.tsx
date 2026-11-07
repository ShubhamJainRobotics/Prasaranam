import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateProjectDialog } from './CreateProjectDialog.js';

export interface ProjectSummary {
  id: string;
  name: string;
  domain: string;
}

export interface ProjectSwitcherProps {
  orgId: string;
  projects: ProjectSummary[];
  currentProjectId?: string;
  onProjectCreated?: (project: ProjectSummary) => void;
}

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({
  orgId,
  projects,
  currentProjectId,
  onProjectCreated,
}) => {
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === '__new__') {
      setIsCreateOpen(true);
    } else if (value && value !== currentProjectId) {
      navigate(`/app/projects/${value}`);
    }
  };

  return (
    <div className="w-full">
      <label
        htmlFor="project-switcher"
        className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
      >
        Project
      </label>
      <div className="relative">
        <select
          id="project-switcher"
          value={currentProjectId || ''}
          onChange={handleChange}
          className="block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1.5 pl-3 pr-8 text-sm font-medium text-[var(--color-text)] shadow-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__new__">+ New Project...</option>
        </select>
      </div>

      <CreateProjectDialog
        orgId={orgId}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(project) => {
          if (onProjectCreated) onProjectCreated(project);
          navigate(`/app/projects/${project.id}`);
        }}
      />
    </div>
  );
};
