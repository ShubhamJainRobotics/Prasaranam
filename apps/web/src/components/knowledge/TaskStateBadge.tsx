import React from 'react';
import type { WorkState } from '@relay/contracts';

interface Props {
  state: WorkState;
  className?: string;
}

export const TaskStateBadge: React.FC<Props> = ({ state, className = '' }) => {
  switch (state) {
    case 'completed':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}
        >
          Completed
        </span>
      );
    case 'in_progress':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 ${className}`}
        >
          In progress
        </span>
      );
    case 'open':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cyan-50 text-cyan-800 border border-cyan-200 ${className}`}
        >
          Open
        </span>
      );
    case 'blocked':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200 ${className}`}
        >
          Blocked
        </span>
      );
    case 'proposed':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 ${className}`}
        >
          Proposed
        </span>
      );
    case 'cancelled':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200 line-through ${className}`}
        >
          Cancelled
        </span>
      );
    case 'superseded':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 line-through ${className}`}
        >
          Superseded
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200 ${className}`}
        >
          Unknown state
        </span>
      );
  }
};
