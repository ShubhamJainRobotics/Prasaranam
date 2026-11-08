import React, { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addOrgMemberSchema, type AddOrgMemberInput } from '@relay/contracts';
import { apiFetch } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.js';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface AddOrgMemberDialogProps {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  onMemberAdded?: () => void;
}

export const AddOrgMemberDialog: React.FC<AddOrgMemberDialogProps> = ({
  orgId,
  isOpen,
  onClose,
  onMemberAdded,
}) => {
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
  } = useForm<AddOrgMemberInput>({
    resolver: zodResolver(addOrgMemberSchema),
    defaultValues: {
      email: '',
      role: 'member',
    },
  });

  if (!isOpen) return null;

  const onSubmit = async (values: AddOrgMemberInput) => {
    setSubmitting(true);
    setApiError(null);
    try {
      const res = await apiFetch<{ message: string }>(`/organisations/${orgId}/members`, {
        method: 'POST',
        body: JSON.stringify(values),
      });
      addToast(
        res.message || 'If an account exists with this email, the user has been added.',
        'success'
      );
      reset();
      if (onMemberAdded) onMemberAdded();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add member';
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
      aria-labelledby="add-org-member-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg bg-[var(--color-surface)] p-6 shadow-xl border border-[var(--color-border)]"
      >
        <h2 id="add-org-member-title" className="text-lg font-semibold text-[var(--color-text)]">
          Add Organisation Member
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Invite a user by email and assign an organisation role.
        </p>

        {apiError && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="member-email"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Email Address
            </label>
            <input
              id="member-email"
              type="email"
              autoFocus
              {...register('email')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              placeholder="colleague@example.com"
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <label
              htmlFor="member-role"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Organisation Role
            </label>
            <select
              id="member-role"
              {...register('role')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            {errors.role && <p className="mt-1 text-xs text-red-600">{errors.role.message}</p>}
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
              {submitting ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
