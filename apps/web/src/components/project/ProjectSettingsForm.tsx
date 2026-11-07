import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateProjectSchema, type UpdateProjectInput } from '@relay/contracts';
import { apiFetch } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.js';

export interface ProjectSettingsFormProps {
  project: {
    id: string;
    name: string;
    description?: string | null;
    domain: string;
    timezone?: string | null;
  };
  onUpdated: () => void;
}

export const ProjectSettingsForm: React.FC<ProjectSettingsFormProps> = ({ project, onUpdated }) => {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<UpdateProjectInput>({
    resolver: zodResolver(updateProjectSchema),
    defaultValues: {
      name: project.name,
      description: project.description || '',
      domain: (project.domain as any) || 'general',
      timezone: project.timezone || 'UTC',
    },
  });

  const onSubmit = async (values: UpdateProjectInput) => {
    setSubmitting(true);
    setApiError(null);
    try {
      await apiFetch(`/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
      addToast('Project settings updated successfully', 'success');
      onUpdated();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update project settings';
      setApiError(msg);
      addToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
    >
      {apiError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
          {apiError}
        </div>
      )}

      <div>
        <label
          htmlFor="settings-name"
          className="block text-sm font-medium text-[var(--color-text)]"
        >
          Project Name
        </label>
        <input
          id="settings-name"
          type="text"
          {...register('name')}
          className="mt-1 block w-full max-w-lg rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label
          htmlFor="settings-domain"
          className="block text-sm font-medium text-[var(--color-text)]"
        >
          Domain
        </label>
        <select
          id="settings-domain"
          {...register('domain')}
          className="mt-1 block w-full max-w-lg rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
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
        <label htmlFor="settings-tz" className="block text-sm font-medium text-[var(--color-text)]">
          Timezone
        </label>
        <input
          id="settings-tz"
          type="text"
          {...register('timezone')}
          className="mt-1 block w-full max-w-lg rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
        {errors.timezone && <p className="mt-1 text-xs text-red-600">{errors.timezone.message}</p>}
      </div>

      <div>
        <label
          htmlFor="settings-desc"
          className="block text-sm font-medium text-[var(--color-text)]"
        >
          Description
        </label>
        <textarea
          id="settings-desc"
          rows={3}
          {...register('description')}
          className="mt-1 block w-full max-w-lg rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
        {errors.description && (
          <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
        )}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={submitting || !isDirty}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
        >
          {submitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
};
