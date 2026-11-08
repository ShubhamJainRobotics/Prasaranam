import React from 'react';
import type { ClaimCategory, WorkState, EvidenceState, ReviewState } from '@relay/contracts';

interface Props {
  search: string;
  onSearchChange: (val: string) => void;
  kind?: ClaimCategory;
  onKindChange: (val?: ClaimCategory) => void;
  workState?: WorkState;
  onWorkStateChange: (val?: WorkState) => void;
  evidenceState?: EvidenceState;
  onEvidenceStateChange: (val?: EvidenceState) => void;
  reviewState?: ReviewState;
  onReviewStateChange: (val?: ReviewState) => void;
  onReset: () => void;
}

export const KnowledgeFilters: React.FC<Props> = ({
  search,
  onSearchChange,
  kind,
  onKindChange,
  workState,
  onWorkStateChange,
  evidenceState,
  onEvidenceStateChange,
  reviewState,
  onReviewStateChange,
  onReset,
}) => {
  const hasActiveFilters = Boolean(search || kind || workState || evidenceState || reviewState);

  return (
    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Search */}
        <div className="lg:col-span-1">
          <label
            htmlFor="filter-search-claims"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Search
          </label>
          <input
            id="filter-search-claims"
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search claims..."
            className="w-full text-sm px-3 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 focus:border-teal-600"
          />
        </div>

        {/* Kind */}
        <div>
          <label
            htmlFor="filter-category"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Category
          </label>
          <select
            id="filter-category"
            value={kind || ''}
            onChange={(e) =>
              onKindChange(e.target.value ? (e.target.value as ClaimCategory) : undefined)
            }
            className="w-full text-sm px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 focus:border-teal-600 bg-white"
          >
            <option value="">All Categories</option>
            <option value="decision">Decision</option>
            <option value="proposal">Proposal</option>
            <option value="task">Task</option>
            <option value="blocker">Blocker</option>
            <option value="risk">Risk</option>
            <option value="dependency">Dependency</option>
            <option value="responsibility">Responsibility</option>
            <option value="contact">Contact</option>
            <option value="open_question">Open Question</option>
          </select>
        </div>

        {/* Work State */}
        <div>
          <label
            htmlFor="filter-work-state"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Work State
          </label>
          <select
            id="filter-work-state"
            value={workState || ''}
            onChange={(e) =>
              onWorkStateChange(e.target.value ? (e.target.value as WorkState) : undefined)
            }
            className="w-full text-sm px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 focus:border-teal-600 bg-white"
          >
            <option value="">All States</option>
            <option value="proposed">Proposed</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="superseded">Superseded</option>
          </select>
        </div>

        {/* Evidence State */}
        <div>
          <label
            htmlFor="filter-evidence-state"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Evidence State
          </label>
          <select
            id="filter-evidence-state"
            value={evidenceState || ''}
            onChange={(e) =>
              onEvidenceStateChange(e.target.value ? (e.target.value as EvidenceState) : undefined)
            }
            className="w-full text-sm px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 focus:border-teal-600 bg-white"
          >
            <option value="">All Evidence States</option>
            <option value="corroborated">Corroborated</option>
            <option value="supported">Supported</option>
            <option value="needs_confirmation">Needs Confirmation</option>
            <option value="conflicting">Conflicting</option>
          </select>
        </div>

        {/* Review State */}
        <div>
          <label
            htmlFor="filter-review-status"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Review Status
          </label>
          <select
            id="filter-review-status"
            value={reviewState || ''}
            onChange={(e) =>
              onReviewStateChange(e.target.value ? (e.target.value as ReviewState) : undefined)
            }
            className="w-full text-sm px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 focus:border-teal-600 bg-white"
          >
            <option value="">All Review Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Clear Filters
          </button>
        </div>
      )}
    </div>
  );
};
