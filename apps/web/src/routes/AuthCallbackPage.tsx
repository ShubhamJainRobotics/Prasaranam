import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Exchange code if PKCE or parse hash
        const code = searchParams.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        // Ensure session is active
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (session) {
          await refreshProfile();

          // Restrict redirect target strictly to the app origin
          let target = searchParams.get('redirect') || '/app';
          try {
            // Check if absolute URL or relative
            if (target.startsWith('/') && !target.startsWith('//')) {
              // Valid relative app path
            } else {
              const parsed = new URL(target, window.location.origin);
              if (parsed.origin !== window.location.origin) {
                target = '/app';
              } else {
                target = parsed.pathname + parsed.search + parsed.hash;
              }
            }
          } catch {
            target = '/app';
          }

          // If type is recovery, go to reset-password
          const type = searchParams.get('type');
          if (type === 'recovery') {
            target = '/reset-password';
          }

          navigate(target, { replace: true });
        } else {
          // No session found, redirect to login
          navigate('/login', { replace: true });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Authentication verification failed';
        setError(msg);
      }
    };

    handleAuthCallback();
  }, [navigate, searchParams, refreshProfile]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-[var(--color-surface)] p-8 text-center shadow-sm">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center bg-red-100 text-red-600 font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
            Authentication Error
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{error}</p>
          <button
            onClick={() => navigate('/login')}
            className="mt-6 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)]"
          >
            Return to Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm">
        <LoadingSkeleton lines={3} />
        <p className="mt-4 text-sm text-[var(--color-text-muted)] animate-pulse">
          Completing authentication...
        </p>
      </div>
    </div>
  );
};
