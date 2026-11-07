import React from 'react';
import type { ClaimSummary } from '@relay/contracts';
import { TaskStateBadge } from './TaskStateBadge.js';
import { EvidenceStateBadge } from './EvidenceStateBadge.js';

interface Props {
  claims: ClaimSummary[];
  onSelectClaim: (claim: ClaimSummary) => void;
}

export const DependencyList: React.FC<Props> = ({ claims, onSelectClaim }) => {
  const items = claims.filter(
    (c) => c.kind === 'dependency' || c.kind === 'blocker' || c.kind === 'risk'
  );

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500 bg-white rounded-lg border border-slate-200">
        No active dependencies, blockers, or risks recorded.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4 shadow-2xs">
      <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
        Blockers, Dependencies & Risks ({items.length})
      </h3>

      <div className="space-y-3">
        {items.map((claim) => {
          const isBlocker = claim.kind === 'blocker';
          const isRisk = claim.kind === 'risk';

          return (
            <div
              key={claim.id}
              onClick={() => onSelectClaim(claim)}
              className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                      isBlocker
                        ? 'bg-rose-100 text-rose-800'
                        : isRisk
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-indigo-100 text-indigo-800'
                    }`}
                  >
                    {claim.kind}
                  </span>
                  <TaskStateBadge state={claim.workState} />
                  <EvidenceStateBadge state={claim.evidenceState} />
                </div>
                {claim.observedAt && (
                  <span className="text-slate-400 font-mono text-[11px]">
                    {new Date(claim.observedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              <p className="text-sm text-slate-900 font-medium">{claim.statement}</p>

              {claim.ownerDisplayName && (
                <div className="text-xs text-slate-500">
                  Contact / Owner:{' '}
                  <span className="font-semibold text-slate-700">{claim.ownerDisplayName}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
