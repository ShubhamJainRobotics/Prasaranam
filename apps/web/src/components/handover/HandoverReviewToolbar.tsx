import React from 'react';

interface Props {
  status: string;
  totalItems: number;
  reviewedItems: number;
  approvedItems: number;
  isRecipientPreview: boolean;
  onToggleRecipientPreview: () => void;
  onOpenApprovalModal: () => void;
  onOpenShareModal: () => void;
  onCreateRevision: () => Promise<void>;
  onOpenAddContextModal: () => void;
  onOpenAuditDrawer: () => void;
  loading?: boolean;
}

export const HandoverReviewToolbar: React.FC<Props> = ({
  status,
  totalItems,
  reviewedItems,
  approvedItems,
  isRecipientPreview,
  onToggleRecipientPreview,
  onOpenApprovalModal,
  onOpenShareModal,
  onCreateRevision,
  onOpenAddContextModal,
  onOpenAuditDrawer,
  loading = false,
}) => {
  const isDraft = status === 'draft';
  const isApproved = status === 'approved';
  const isShared = status === 'shared';
  const allReviewed = totalItems > 0 && reviewedItems === totalItems;
  const canApprove = isDraft && allReviewed && approvedItems > 0;

  return (
    <div className="sticky top-14 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-6 py-3 shadow-2xs flex flex-wrap items-center justify-between gap-4">
      {/* Left: Progress info */}
      <div className="flex items-center gap-4">
        {isDraft && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Review Progress:
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={`text-sm font-bold ${
                  allReviewed ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {reviewedItems} / {totalItems}
              </span>
              <span className="text-xs text-slate-500">items reviewed</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onOpenAuditDrawer}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 font-medium px-2.5 py-1 rounded-md border border-slate-200 hover:bg-slate-50"
        >
          <svg
            className="w-3.5 h-3.5 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Review History
        </button>
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-2.5">
        {/* Toggle Recipient Preview */}
        <button
          type="button"
          onClick={onToggleRecipientPreview}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
            isRecipientPreview
              ? 'bg-purple-100 text-purple-900 border-purple-300 font-semibold shadow-xs'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
        >
          {isRecipientPreview ? 'Exit Recipient Preview' : 'Preview as Recipient'}
        </button>

        {/* Add Context Button */}
        {isDraft && (
          <button
            type="button"
            onClick={onOpenAddContextModal}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            Add Context Source
          </button>
        )}

        {/* Approve Draft Button */}
        {isDraft && (
          <button
            type="button"
            onClick={onOpenApprovalModal}
            disabled={!canApprove || loading}
            title={
              !allReviewed
                ? 'All items must be approved or rejected first'
                : approvedItems === 0
                  ? 'At least one item must be approved'
                  : 'Approve this version'
            }
            className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-xs transition-colors"
          >
            Approve Draft
          </button>
        )}

        {/* Share Button */}
        {isApproved && (
          <button
            type="button"
            onClick={onOpenShareModal}
            disabled={loading}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs transition-colors"
          >
            Share with Recipient
          </button>
        )}

        {/* Create Revision Button */}
        {(isApproved || isShared) && (
          <button
            type="button"
            onClick={onCreateRevision}
            disabled={loading}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors"
          >
            Create New Revision
          </button>
        )}
      </div>
    </div>
  );
};
