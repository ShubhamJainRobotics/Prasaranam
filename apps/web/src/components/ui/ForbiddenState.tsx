import React from 'react';
import { Link } from 'react-router-dom';

export const ForbiddenState: React.FC<{
  title?: string;
  message?: string;
}> = ({
  title = 'Access Denied',
  message = 'You do not have permission to view or manage this resource.',
}) => {
  return (
    <div className="text-center py-16 px-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div
        className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center bg-red-100 text-red-600 font-bold text-xl"
        aria-hidden="true"
      >
        !
      </div>
      <h2 className="text-xl font-bold text-[var(--color-text)] mb-2">{title}</h2>
      <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto mb-6">{message}</p>
      <Link
        to="/app"
        className="inline-flex px-4 py-2 rounded-md font-medium text-sm bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] hover:bg-[var(--color-bg)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
      >
        Return to Workspace
      </Link>
    </div>
  );
};
