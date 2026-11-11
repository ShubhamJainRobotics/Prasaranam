import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { resetPasswordSchema, type ResetPasswordInput } from '@relay/contracts';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

export const ResetPasswordPage: React.FC = () => {
  const { updatePassword } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = async (values: ResetPasswordInput) => {
    setSubmitting(true);
    setApiError(null);
    try {
      await updatePassword(values.password);
      addToast('Password updated successfully! You can now sign in.', 'success');
      navigate('/login');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      setApiError(msg);
      addToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div className="text-center mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 mb-4 font-bold text-xl text-[var(--color-primary)]"
          >
            <div className="h-8 w-8 rounded bg-[var(--color-primary)] text-white flex items-center justify-center font-black text-sm">
              P
            </div>
            <span className="text-[var(--color-text)] tracking-tight">Prasaranam</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
            Set a new password
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Please enter your new secure password below.
          </p>
        </div>

        {apiError && (
          <div
            className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200"
            role="alert"
          >
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label
              htmlFor="new-pass"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              New Password
            </label>
            <input
              id="new-pass"
              type="password"
              autoComplete="new-password"
              autoFocus
              {...register('password')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">At least 8 characters.</p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-[var(--color-primary)] py-2.5 px-4 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50 transition-colors shadow-sm"
          >
            {submitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};
