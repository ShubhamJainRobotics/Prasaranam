import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { useToast } from '../../context/ToastContext.js';

export const Topbar: React.FC = () => {
  const { user, profile, signOut } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      addToast('Signed out successfully', 'info');
      navigate('/login');
    } catch {
      addToast('Error signing out', 'error');
    }
  };

  const displayName = profile?.displayName || user?.email?.split('@')[0] || 'User';

  return (
    <header className="h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="flex items-center gap-2 font-bold text-lg text-[var(--color-primary)] hover:opacity-90 transition-opacity"
        >
          <div className="h-7 w-7 rounded bg-[var(--color-primary)] text-white flex items-center justify-center font-black text-sm">
            R
          </div>
          <span className="tracking-tight text-[var(--color-text)]">Relay</span>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <Link
          to="/app/settings"
          className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors flex items-center gap-2"
        >
          <div className="h-7 w-7 rounded-full bg-[var(--color-primary-subtle)] text-[var(--color-primary)] flex items-center justify-center font-semibold text-xs border border-[var(--color-border)]">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <span className="hidden sm:inline">{displayName}</span>
        </Link>

        <button
          onClick={handleSignOut}
          className="text-xs font-medium text-[var(--color-text-muted)] hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-[var(--color-surface-hover)]"
        >
          Sign out
        </button>
      </div>
    </header>
  );
};
