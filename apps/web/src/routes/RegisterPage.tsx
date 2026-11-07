import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { registerSchema, type RegisterInput } from '@relay/contracts';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

export const RegisterPage: React.FC = () => {
  const { signUp } = useAuth();
  const { addToast } = useToast();
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', displayName: '' },
  });

  const onSubmit = async (values: RegisterInput) => {
    setSubmitting(true);
    setApiError(null);
    try {
      await signUp(values.email, values.password, values.displayName);
      setRegisteredEmail(values.email);
      setConfirmationSent(true);
      addToast('Account created! Please check your email for confirmation.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setApiError(msg);
      addToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm">
          <div
            className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center bg-teal-50 text-[var(--color-primary)] font-bold text-xl"
            aria-hidden="true"
          >
            ✉
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
            Check your email
          </h1>
          <p className="mt-3 text-sm text-[var(--color-text-muted)] leading-relaxed">
            We sent a verification link to{' '}
            <strong className="text-[var(--color-text)]">{registeredEmail}</strong>. Please click
            the link to confirm your account and log in.
          </p>
          <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
            <Link
              to="/login"
              className="inline-block w-full rounded-md bg-[var(--color-primary)] py-2.5 px-4 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] transition-colors"
            >
              Back to Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
            Create your account
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Join Relay to create evidence-backed project handovers.
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
              htmlFor="reg-name"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Full Display Name
            </label>
            <input
              id="reg-name"
              type="text"
              autoComplete="name"
              autoFocus
              {...register('displayName')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              placeholder="Alice Walker"
            />
            {errors.displayName && (
              <p className="mt-1 text-xs text-red-600">{errors.displayName.message}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="reg-email"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Email address
            </label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              {...register('email')}
              className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              placeholder="you@example.com"
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <label
              htmlFor="reg-password"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
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
            className="w-full rounded-md bg-[var(--color-primary)] py-2.5 px-4 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50 transition-colors shadow-sm mt-2"
          >
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-[var(--color-primary)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};
