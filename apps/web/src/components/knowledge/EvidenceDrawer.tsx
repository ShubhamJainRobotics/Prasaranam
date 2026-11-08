import React, { useRef } from 'react';
import type { ClaimDetail, ClaimSummary } from '@relay/contracts';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  claim: ClaimDetail | ClaimSummary | null;
  isOpen: boolean;
  onClose: () => void;
}

export const EvidenceDrawer: React.FC<Props> = ({ claim, isOpen, onClose }) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, { isOpen, onClose });

  if (!isOpen || !claim) return null;

  const evidenceList = ('evidence' in claim ? claim.evidence : []) || [];

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      aria-labelledby="evidence-drawer-title"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <div
          ref={drawerRef}
          className="w-screen max-w-full sm:max-w-md bg-white shadow-xl flex flex-col border-l border-slate-200 focus:outline-none"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div>
              <h2 id="evidence-drawer-title" className="text-base font-semibold text-slate-900">
                Supporting Evidence
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Exact quotations validated against source documents
              </p>
            </div>
            <button
              type="button"
              aria-label="Close evidence drawer"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-600"
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

          {/* Claim Statement Preview */}
          <div className="p-4 bg-teal-50/50 border-b border-teal-100">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-800">
              Claim Statement
            </span>
            <p className="text-sm text-slate-800 mt-1 font-medium">{claim.statement}</p>
          </div>

          {/* Evidence List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {evidenceList.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500">
                Loading evidence details...
              </div>
            ) : (
              evidenceList.map((ev, idx) => (
                <div
                  key={ev.id || idx}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2 shadow-2xs"
                >
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="font-semibold text-slate-800 truncate" title={ev.sourceTitle}>
                      {ev.sourceTitle}
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      offsets: [{ev.quoteStart}, {ev.quoteEnd})
                    </span>
                  </div>

                  <blockquote className="text-sm text-slate-900 bg-white p-2.5 rounded border border-slate-200/80 font-mono text-xs leading-relaxed border-l-4 border-l-teal-600">
                    &ldquo;{ev.quote}&rdquo;
                  </blockquote>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
