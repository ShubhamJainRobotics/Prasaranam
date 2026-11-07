import React from 'react';
import type { ClaimSummary } from '@relay/contracts';
import { EvidenceStateBadge } from './EvidenceStateBadge.js';

interface Props {
  claims: ClaimSummary[];
  onSelectClaim: (claim: ClaimSummary) => void;
  onNavigateQuestions: () => void;
}

export const ConflictPanel: React.FC<Props> = ({ claims, onSelectClaim, onNavigateQuestions }) => {
  const conflictingClaims = claims.filter((c) => c.evidenceState === 'conflicting');

  if (conflictingClaims.length === 0) return null;

  return (
    <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-rose-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3 className="text-sm font-semibold text-rose-900">
            Detected Evidence Conflicts ({conflictingClaims.length})
          </h3>
        </div>

        <button
          type="button"
          onClick={onNavigateQuestions}
          className="text-xs font-semibold text-rose-700 hover:text-rose-900 underline"
        >
          View Clarification Questions →
        </button>
      </div>

      <p className="text-xs text-rose-700 leading-relaxed">
        The system detected direct contradictions between source passages. Contradictions remain
        visible until resolved by new evidence or clarification answers.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {conflictingClaims.map((claim) => (
          <div
            key={claim.id}
            onClick={() => onSelectClaim(claim)}
            className="bg-white p-3 rounded border border-rose-200 hover:border-rose-400 cursor-pointer shadow-2xs space-y-1.5 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-800 bg-rose-50 px-1.5 py-0.5 rounded">
                {claim.kind}
              </span>
              <EvidenceStateBadge state={claim.evidenceState} />
            </div>
            <p className="text-xs text-slate-800 font-medium line-clamp-2">{claim.statement}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
