import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema, type CreateProjectInput } from '@relay/contracts';
import { apiFetch } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.js';

export interface CreateProjectDialogProps {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: { id: string; name: string; domain: string }) => void;
}

export const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  orgId,
  isOpen,
  onClose,
  onCreated,
}) => {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      description: '',
      domain: 'general',
      timezone: 'UTC',
    },
  });

  if (!isOpen) return null;

  const onSubmit = async (values: CreateProjectInput) => {
    setSubmitting(true);
    setApiError(null);
    try {
      const created = await apiFetch<{ id: string; name: string; domain: string }>(
        `/organisations/${orgId}/projects`,
        {
          method: 'POST',
          body: JSON.stringify(values),
        }
      );
      addToast('Project created successfully', 'success');
      reset();
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create project';
      setApiError(msg);
      addToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
    >
      <div className="w-full max-w-md rounded-lg bg-[var(--color-surface)] p-6 shadow-xl border border-[var(--color-border)]">
        <h2 id="create-project-title" className="text-lg font-semibold text-[var(--color-text)]">
          Create New Project
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Projects house documents, claims, audio files, and handovers.
        </p>

        {apiError && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="project-name"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Project Name
            </label>
            <input
              id="project-name"
              type="text"
              autoFocus
              {...register('name')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              placeholder="e.g. Q3 Clinical Audit"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

          <div>
            <label
              htmlFor="project-domain"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Domain
            </label>
            <select
              id="project-domain"
              {...register('domain')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            >
              <option value="general">General</option>
              <option value="software_engineering">Software Engineering</option>
              <option value="research">Research</option>
              <option value="student_team">Student Team</option>
              <option value="nonprofit_operations">Nonprofit Operations</option>
            </select>
            {errors.domain && <p className="mt-1 text-xs text-red-600">{errors.domain.message}</p>}
          </div>

          <div>
            <label
              htmlFor="project-desc"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Description (Optional)
            </label>
            <textarea
              id="project-desc"
              rows={2}
              {...register('description')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              placeholder="Brief summary of the project scope"
            />
            {errors.description && (
              <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
