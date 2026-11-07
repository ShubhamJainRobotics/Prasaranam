import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@relay/contracts';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

export const ForgotPasswordPage: React.FC = () => {
  const { requestPasswordReset } = useAuth();
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordInput) => {
    setSubmitting(true);
    setApiError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
      addToast('Password reset link sent to your email', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to request password reset';
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
              R
            </div>
            <span className="text-[var(--color-text)] tracking-tight">Relay</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Enter your email address and we will send you a link to reset your password.
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

        {sent ? (
          <div className="text-center space-y-4">
            <div className="rounded-md bg-teal-50 p-4 text-sm text-teal-800 border border-teal-200">
              Check your inbox for a password reset email. Follow the link to create a new password.
            </div>
            <Link
              to="/login"
              className="inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
            >
              Back to Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label
                htmlFor="reset-email"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                Email address
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                autoFocus
                {...register('email')}
                className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                placeholder="you@example.com"
              />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-[var(--color-primary)] py-2.5 px-4 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? 'Sending...' : 'Send reset instructions'}
            </button>

            <p className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
              Remember your password?{' '}
              <Link to="/login" className="font-medium text-[var(--color-primary)] hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
