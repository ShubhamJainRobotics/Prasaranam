import React, { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createOrgSchema, type CreateOrgInput } from '@relay/contracts';
import { apiFetch } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.js';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface CreateOrgDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (org: { id: string; name: string; slug: string }) => void;
}

export const CreateOrgDialog: React.FC<CreateOrgDialogProps> = ({ isOpen, onClose, onCreated }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { isOpen, onClose });

  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOrgInput>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: '' },
  });

  if (!isOpen) return null;

  const onSubmit = async (values: CreateOrgInput) => {
    setSubmitting(true);
    setApiError(null);
    try {
      const created = await apiFetch<{ id: string; name: string; slug: string }>('/organisations', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      addToast('Organisation created successfully', 'success');
      reset();
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create organisation';
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
      aria-labelledby="create-org-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg bg-[var(--color-surface)] p-6 shadow-xl border border-[var(--color-border)]"
      >
        <h2 id="create-org-title" className="text-lg font-semibold text-[var(--color-text)]">
          Create New Organisation
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Organisations group your projects and team members together.
        </p>

        {apiError && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="org-name"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Organisation Name
            </label>
            <input
              id="org-name"
              type="text"
              autoFocus
              {...register('name')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              placeholder="e.g. Acme Health"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
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
              {submitting ? 'Creating...' : 'Create Organisation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
