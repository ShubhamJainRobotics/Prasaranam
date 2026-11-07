import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  updateProfileSchema,
  resetPasswordSchema,
  type UpdateProfileInput,
  type ResetPasswordInput,
} from '@relay/contracts';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { apiFetch } from '../lib/api.js';

export const AccountSettingsPage: React.FC = () => {
  const { user, profile, refreshProfile, updatePassword } = useAuth();
  const { addToast } = useToast();

  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  // Profile Form
  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    formState: { errors: profileErrors, isDirty: profileDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      displayName: profile?.displayName || '',
    },
    values: {
      displayName: profile?.displayName || '',
    },
  });

  // Password Form
  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    reset: resetPasswordForm,
    formState: { errors: passwordErrors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
    },
  });

  const onUpdateProfile = async (values: UpdateProfileInput) => {
    setProfileSubmitting(true);
    try {
      await apiFetch('/me', {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
      await refreshProfile();
      addToast('Profile updated successfully', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update profile';
      addToast(msg, 'error');
    } finally {
      setProfileSubmitting(false);
    }
  };

  const onUpdatePassword = async (values: ResetPasswordInput) => {
    setPasswordSubmitting(true);
    try {
      await updatePassword(values.password);
      resetPasswordForm();
      addToast('Password updated successfully', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      addToast(msg, 'error');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Workspace', href: '/app' }, { label: 'Account Settings' }]} />

      <PageHeader
        title="Account Settings"
        description="Manage your user profile and security preferences."
      />

      <div className="max-w-2xl space-y-8">
        {/* Profile Card */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-base font-semibold text-[var(--color-text)] mb-1">
            Personal Information
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-5">
            Your display name is shown to team members across projects.
          </p>

          <form onSubmit={handleProfileSubmit(onUpdateProfile)} className="space-y-4">
            <div>
              <label
                htmlFor="account-email"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                Email Address
              </label>
              <input
                id="account-email"
                type="email"
                disabled
                value={user?.email || ''}
                className="mt-1 block w-full rounded-md border border-[var(--color-border)] bg-slate-50 px-3 py-2 text-sm text-[var(--color-text-muted)] cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Email address cannot be changed directly.
              </p>
            </div>

            <div>
              <label
                htmlFor="account-name"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                Display Name
              </label>
              <input
                id="account-name"
                type="text"
                {...registerProfile('displayName')}
                className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              />
              {profileErrors.displayName && (
                <p className="mt-1 text-xs text-red-600">{profileErrors.displayName.message}</p>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={profileSubmitting || !profileDirty}
                className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
              >
                {profileSubmitting ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>

        {/* Password Card */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-base font-semibold text-[var(--color-text)] mb-1">Change Password</h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-5">
            Ensure your account is using a long, secure password.
          </p>

          <form onSubmit={handlePasswordSubmit(onUpdatePassword)} className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                New Password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                {...registerPassword('password')}
                className="mt-1 block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              />
              {passwordErrors.password && (
                <p className="mt-1 text-xs text-red-600">{passwordErrors.password.message}</p>
              )}
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Must be at least 8 characters long.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={passwordSubmitting}
                className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
              >
                {passwordSubmitting ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
