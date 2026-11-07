import React from 'react';
import { Link } from 'react-router-dom';

export interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    slug: string;
    domain: string;
    description?: string | null;
    created_at?: string;
  };
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition-shadow hover:shadow-md">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/app/projects/${project.id}`}
            className="text-base font-semibold text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors line-clamp-1"
          >
            {project.name}
          </Link>
          <span className="inline-flex items-center rounded-full bg-[var(--color-primary-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)] capitalize">
            {project.domain.replace('_', ' ')}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--color-text-muted)] line-clamp-2 min-h-[2.5rem]">
          {project.description || 'No description provided.'}
        </p>
      </div>

      <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-muted)]">
          {project.created_at ? new Date(project.created_at).toLocaleDateString() : ''}
        </span>
        <Link
          to={`/app/projects/${project.id}`}
          className="text-sm font-medium text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
        >
          Open Project &rarr;
        </Link>
      </div>
    </div>
  );
};
