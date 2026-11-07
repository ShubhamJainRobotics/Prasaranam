import React from 'react';

export const DemoModeBanner: React.FC = () => {
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  if (!isDemo) {
    return null;
  }

  return (
    <div
      role="status"
      className="bg-amber-500 text-amber-950 px-4 py-1.5 text-xs font-semibold text-center tracking-wide flex items-center justify-center gap-2 shadow-sm"
    >
      <svg
        className="w-4 h-4 text-amber-950 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>Demo mode: AI output is simulated</span>
    </div>
  );
};
