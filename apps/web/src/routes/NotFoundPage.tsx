import React from 'react';

export const NotFoundPage: React.FC = () => {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold mb-6"
        style={{ backgroundColor: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}
        aria-hidden="true"
      >
        404
      </div>
      <h1 className="text-3xl font-extrabold mb-3" style={{ color: 'var(--color-text)' }}>
        Page not found
      </h1>
      <p className="text-base max-w-md mb-8" style={{ color: 'var(--color-text-muted)' }}>
        The page you are looking for does not exist or has been moved to another location.
      </p>
      <a
        href="/"
        className="px-6 py-3 rounded-md font-semibold text-sm transition-colors focus:outline-none focus:ring-2 shadow-xs"
        style={{
          backgroundColor: 'var(--color-primary)',
          color: 'var(--color-primary-text)',
        }}
      >
        Return to Home
      </a>
    </div>
  );
};
