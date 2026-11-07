import React from 'react';
import type { ClaimSummary } from '@relay/contracts';
import { TaskStateBadge } from './TaskStateBadge.js';
import { EvidenceStateBadge } from './EvidenceStateBadge.js';

interface Props {
  claims: ClaimSummary[];
  onSelectClaim: (claim: ClaimSummary) => void;
}

export const DecisionTimeline: React.FC<Props> = ({ claims, onSelectClaim }) => {
  const decisions = claims
    .filter((c) => c.kind === 'decision' || c.kind === 'proposal')
    .sort((a, b) => {
      const dateA = a.observedAt || a.createdAt;
      const dateB = b.observedAt || b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

  if (decisions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500 bg-white rounded-lg border border-slate-200">
        No decisions or proposals recorded yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4 shadow-2xs">
      <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
        Decision & Proposal Timeline
      </h3>

      <div className="relative border-l-2 border-teal-200 ml-4 space-y-6 py-2">
        {decisions.map((claim) => {
          const isDecision = claim.kind === 'decision';
          const displayDate = claim.observedAt
            ? new Date(claim.observedAt).toLocaleDateString()
            : new Date(claim.createdAt).toLocaleDateString();

          return (
            <div key={claim.id} className="relative pl-6">
              {/* Dot */}
              <div
                className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${
                  isDecision ? 'bg-teal-600' : 'bg-purple-500'
                }`}
              />

              <div
                onClick={() => onSelectClaim(claim)}
                className="bg-slate-50 hover:bg-slate-100 p-3.5 rounded-lg border border-slate-200 cursor-pointer transition-colors space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        isDecision ? 'bg-teal-100 text-teal-800' : 'bg-purple-100 text-purple-800'
                      }`}
                    >
                      {claim.kind}
                    </span>
                    <TaskStateBadge state={claim.workState} />
                    <EvidenceStateBadge state={claim.evidenceState} />
                  </div>
                  <span className="text-slate-500 font-mono text-[11px]">{displayDate}</span>
                </div>

                <p className="text-sm text-slate-900 font-medium">{claim.statement}</p>

                {claim.ownerDisplayName && (
                  <div className="text-xs text-slate-500">
                    Proposed / Authored by:{' '}
                    <span className="font-semibold text-slate-700">{claim.ownerDisplayName}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
