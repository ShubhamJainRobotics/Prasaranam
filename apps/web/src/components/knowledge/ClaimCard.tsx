import React from 'react';
import type { ClaimSummary } from '@relay/contracts';
import { EvidenceStateBadge } from './EvidenceStateBadge.js';
import { TaskStateBadge } from './TaskStateBadge.js';
import { ReviewStateBadge } from './ReviewStateBadge.js';

interface Props {
  claim: ClaimSummary;
  onClick: (claim: ClaimSummary) => void;
  onViewEvidence: (claim: ClaimSummary) => void;
}

const KIND_COLORS: Record<string, string> = {
  decision: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  proposal: 'bg-purple-50 text-purple-800 border-purple-200',
  task: 'bg-blue-50 text-blue-800 border-blue-200',
  blocker: 'bg-rose-50 text-rose-800 border-rose-200',
  risk: 'bg-amber-50 text-amber-800 border-amber-200',
  dependency: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  responsibility: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  contact: 'bg-teal-50 text-teal-800 border-teal-200',
  open_question: 'bg-slate-50 text-slate-800 border-slate-200',
};

export const ClaimCard: React.FC<Props> = ({ claim, onClick, onViewEvidence }) => {
  const kindBadgeClass = KIND_COLORS[claim.kind] || 'bg-slate-50 text-slate-700 border-slate-200';

  return (
    <div
      data-testid="claim-card"
      onClick={() => onClick(claim)}
      className="bg-white rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all p-4 cursor-pointer space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider border ${kindBadgeClass}`}
          >
            {claim.kind.replace('_', ' ')}
          </span>
          <TaskStateBadge state={claim.workState} />
          <EvidenceStateBadge state={claim.evidenceState} />
          <ReviewStateBadge state={claim.reviewState} />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewEvidence(claim);
          }}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded border border-teal-200 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span>
            {claim.evidenceCount} {claim.evidenceCount === 1 ? 'quote' : 'quotes'}
          </span>
        </button>
      </div>

      <p className="text-sm text-slate-900 font-medium leading-relaxed">{claim.statement}</p>

      <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span>
            {claim.ownerDisplayName ? (
              <span className="font-medium text-slate-700">{claim.ownerDisplayName}</span>
            ) : claim.ownerLabel ? (
              <span className="text-slate-600">{claim.ownerLabel} (unlinked)</span>
            ) : (
              <span className="italic text-slate-500">Unassigned</span>
            )}
          </span>
        </div>

        <div>
          {claim.observedAt ? (
            <span>Observed: {new Date(claim.observedAt).toLocaleDateString()}</span>
          ) : (
            <span className="italic text-slate-500">Undated</span>
          )}
        </div>
      </div>
    </div>
  );
};
