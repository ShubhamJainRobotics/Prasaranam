import React from 'react';

export const LoadingSkeleton: React.FC<{
  className?: string;
  lines?: number;
}> = ({ className = 'h-6 w-full', lines = 1 }) => {
  return (
    <div className="space-y-3 w-full" aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`animate-pulse rounded bg-[var(--color-border)] ${className}`} />
      ))}
    </div>
  );
};
