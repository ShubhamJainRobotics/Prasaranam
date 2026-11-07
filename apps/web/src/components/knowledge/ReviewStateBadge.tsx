import React from 'react';
import type { ReviewState } from '@relay/contracts';

interface Props {
  state: ReviewState;
  className?: string;
}

export const ReviewStateBadge: React.FC<Props> = ({ state, className = '' }) => {
  switch (state) {
    case 'approved':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}
        >
          <svg
            className="w-3 h-3 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
            />
          </svg>
          Approved
        </span>
      );
    case 'rejected':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 ${className}`}
        >
          <svg
            className="w-3 h-3 text-rose-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Rejected
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 ${className}`}
        >
          Pending review
        </span>
      );
  }
};
