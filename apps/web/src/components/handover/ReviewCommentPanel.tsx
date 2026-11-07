import React from 'react';
import type { ReviewRecord } from '@relay/contracts';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  reviews: ReviewRecord[];
}

export const ReviewCommentPanel: React.FC<Props> = ({ isOpen, onClose, reviews }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-panel-title"
    >
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-xl flex flex-col border-l border-slate-200">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div>
              <h2 id="review-panel-title" className="text-base font-semibold text-slate-900">
                Review & Sign-off History
              </h2>
              <p className="text-xs text-slate-500">Audit trail of reviewer actions and comments</p>
            </div>
            <button
              type="button"
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

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {reviews.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                No review events recorded yet.
              </div>
            ) : (
              reviews.map((r) => (
                <div
                  key={r.id}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                      {r.action.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600">
                    by{' '}
                    <span className="font-semibold text-slate-900">
                      {r.reviewerName || 'Reviewer'}
                    </span>
                  </div>

                  {r.confirmedReviewedForRecipient && (
                    <div className="text-[11px] text-teal-800 bg-teal-50 border border-teal-200 rounded px-2 py-0.5 mt-1 font-medium inline-block">
                      Confirmed reviewed for recipient
                    </div>
                  )}

                  {r.comment && (
                    <p className="text-xs text-slate-700 italic pt-1 border-t border-slate-200/60 mt-1">
                      "{r.comment}"
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
