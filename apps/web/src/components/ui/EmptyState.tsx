import React from 'react';

export const EmptyState: React.FC<{
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}> = ({ title, description, action }) => {
  return (
    <div className="text-center py-12 px-4 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]">
      <div
        className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-bold text-xl"
        aria-hidden="true"
      >
        ∅
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--color-text-muted)] max-w-sm mx-auto mb-6">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-md font-medium text-sm bg-[var(--color-primary)] text-[var(--color-primary-text)] hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
