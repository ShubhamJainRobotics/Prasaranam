import React from 'react';
import type { ClaimDetail } from '@relay/contracts';
import { EvidenceStateBadge } from './EvidenceStateBadge.js';
import { TaskStateBadge } from './TaskStateBadge.js';
import { ReviewStateBadge } from './ReviewStateBadge.js';
import { EvidenceCitation } from './EvidenceCitation.js';

interface Props {
  claim: ClaimDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onReview: (claimId: string, newState: 'approved' | 'rejected') => void;
  onOpenOwnerLink: (claim: ClaimDetail) => void;
  onOpenFlag: (claim: ClaimDetail) => void;
}

export const ClaimDetailPanel: React.FC<Props> = ({
  claim,
  isOpen,
  onClose,
  onReview,
  onOpenOwnerLink,
  onOpenFlag,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !claim) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      aria-labelledby="claim-detail-title"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl bg-white shadow-xl flex flex-col border-l border-slate-200">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded">
                  {claim.kind.replace('_', ' ')}
                </span>
                <span className="text-xs text-slate-400 font-mono">{claim.id.slice(0, 8)}</span>
              </div>
              <h2 id="claim-detail-title" className="text-base font-semibold text-slate-900 mt-1">
                Claim Overview
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close claim details"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Statement */}
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Statement
              </span>
              <p className="text-base text-slate-900 font-medium leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                {claim.statement}
              </p>
            </div>

            {/* Badges row */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  Work State
                </span>
                <TaskStateBadge state={claim.workState} />
              </div>
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  Evidence State
                </span>
                <EvidenceStateBadge state={claim.evidenceState} />
              </div>
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  Review Status
                </span>
                <ReviewStateBadge state={claim.reviewState} />
              </div>
            </div>

            {/* Owner Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Ownership
                </span>
                <button
                  type="button"
                  onClick={() => onOpenOwnerLink(claim)}
                  className="text-xs font-medium text-teal-700 hover:text-teal-900"
                >
                  {claim.ownerUserId ? 'Change Owner' : 'Link to Member'}
                </button>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
                {claim.ownerDisplayName ? (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{claim.ownerDisplayName}</span>
                    <span className="text-xs text-slate-400 font-mono">(verified member)</span>
                  </div>
                ) : claim.ownerLabel ? (
                  <div className="text-slate-700">
                    <span>Extracted label: </span>
                    <span className="font-semibold">{claim.ownerLabel}</span>
                    <span className="text-xs text-slate-400 ml-1">(unlinked to user)</span>
                  </div>
                ) : (
                  <span className="text-slate-400 italic">No owner assigned in evidence</span>
                )}
              </div>
            </div>

            {/* Relationships */}
            {claim.relationships && claim.relationships.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Relationships ({claim.relationships.length})
                </span>
                <div className="space-y-2">
                  {claim.relationships.map((rel) => (
                    <div
                      key={rel.id}
                      className="p-3 bg-slate-50 rounded border border-slate-200 text-xs space-y-1"
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                        <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-200">
                          {rel.relation}
                        </span>
                        <span>{rel.direction === 'outgoing' ? '→' : '←'}</span>
                        <span className="truncate">{rel.otherClaimStatement}</span>
                      </div>
                      <p className="text-slate-500 italic">{rel.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Evidence Citations */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Evidence Quotes ({claim.evidence.length})
              </span>
              <div className="space-y-2">
                {claim.evidence.map((ev) => (
                  <EvidenceCitation key={ev.id} evidence={ev} />
                ))}
              </div>
            </div>

            {/* Metadata */}
            <div className="space-y-1 text-xs text-slate-400 border-t border-slate-100 pt-3 font-mono">
              <div>Prompt version: {claim.promptVersion}</div>
              <div>Model: {claim.modelName || 'n/a'}</div>
              <div>Created: {new Date(claim.createdAt).toLocaleString()}</div>
              {claim.observedAt && (
                <div>Observed date: {new Date(claim.observedAt).toLocaleDateString()}</div>
              )}
            </div>
          </div>

          {/* Action Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onOpenFlag(claim)}
              className="px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded"
            >
              Flag Claim
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onReview(claim.id, 'rejected')}
                className="px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded"
              >
                Reject Claim
              </button>
              <button
                type="button"
                onClick={() => onReview(claim.id, 'approved')}
                className="px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded shadow-xs"
              >
                Approve Claim
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
