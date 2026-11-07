import React, { useState } from 'react';
import type { HandoverItem as HandoverItemType, HandoverItemClaimCitation } from '@relay/contracts';
import { EvidenceStateBadge } from '../knowledge/EvidenceStateBadge.js';
import { ReviewStateBadge } from '../knowledge/ReviewStateBadge.js';

interface Props {
  item: HandoverItemType;
  isReviewMode?: boolean;
  onApprove?: (itemId: string, rowVersion: number) => Promise<void>;
  onReject?: (itemId: string, rowVersion: number) => Promise<void>;
  onEdit?: (itemId: string, newText: string, rowVersion: number) => Promise<void>;
  onFlag?: (itemId: string, reason: string) => Promise<void>;
  onSelectCitation?: (citation: HandoverItemClaimCitation) => void;
}

export const HandoverItem: React.FC<Props> = ({
  item,
  isReviewMode = false,
  onApprove,
  onReject,
  onEdit,
  onFlag,
  onSelectCitation,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [isFlagging, setIsFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSaveEdit = async () => {
    if (!editText.trim() || !onEdit) return;
    setLoading(true);
    try {
      await onEdit(item.id, editText.trim(), item.rowVersion);
      setIsEditing(false);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmFlag = async () => {
    if (!flagReason.trim() || !onFlag) return;
    setLoading(true);
    try {
      await onFlag(item.id, flagReason.trim());
      setIsFlagging(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        item.reviewState === 'rejected'
          ? 'bg-slate-50 border-slate-200 opacity-60'
          : item.reviewState === 'approved'
            ? 'bg-white border-emerald-200 shadow-2xs'
            : 'bg-white border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Top Badges Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {/* Text Kind Label (SPEC requirement: distinguish with text labels, not only color) */}
          {item.itemKind === 'fact' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
              Fact
            </span>
          )}
          {item.itemKind === 'suggestion' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
              Suggestion
            </span>
          )}
          {item.itemKind === 'unknown' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-300">
              Unknown
            </span>
          )}

          <EvidenceStateBadge state={item.evidenceState} />
        </div>

        {isReviewMode && <ReviewStateBadge state={item.reviewState} />}
      </div>

      {/* Item Body / Edit Mode */}
      {isEditing ? (
        <div className="mt-2 space-y-2">
          <textarea
            rows={3}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full text-sm rounded-lg border border-slate-300 p-2.5 focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            disabled={loading}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditText(item.text);
                setIsEditing(false);
              }}
              disabled={loading}
              className="px-3 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={loading || !editText.trim()}
              className="px-3 py-1 text-xs font-medium text-white bg-teal-700 rounded hover:bg-teal-800"
            >
              {loading ? 'Saving...' : 'Save Edit'}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
          {item.text}
        </div>
      )}

      {/* Edited by reviewer note */}
      {item.originalText && (
        <div className="mt-2 text-xs text-amber-800 bg-amber-50/70 border border-amber-200/60 rounded px-2.5 py-1 inline-flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-amber-600 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          <span>Edited by reviewer; wording not machine-verified</span>
        </div>
      )}

      {/* Flag input inline */}
      {isFlagging && (
        <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2">
          <label className="block text-xs font-semibold text-rose-900">
            Flag reason or contradiction note:
          </label>
          <input
            type="text"
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            placeholder="e.g. Contradicts updated launch timeline"
            className="w-full text-xs rounded border border-rose-300 p-2 focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            disabled={loading}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsFlagging(false)}
              disabled={loading}
              className="px-2.5 py-1 text-xs text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmFlag}
              disabled={loading || !flagReason.trim()}
              className="px-2.5 py-1 text-xs font-medium text-white bg-rose-700 rounded hover:bg-rose-800"
            >
              {loading ? 'Flagging...' : 'Downgrade Evidence'}
            </button>
          </div>
        </div>
      )}

      {/* Citations Footer */}
      {item.citations && item.citations.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mr-1">
            Evidence:
          </span>
          {item.citations.map((c, idx) => (
            <button
              key={`${c.claimId}-${idx}`}
              type="button"
              onClick={() => onSelectCitation?.(c)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-200"
              title={c.quote || c.statement}
            >
              <svg
                className="w-3 h-3 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              <span className="truncate max-w-[180px]">{c.sourceTitle || 'Source'}</span>
              <span className="text-[10px] text-slate-500">#{idx + 1}</span>
            </button>
          ))}
        </div>
      )}

      {/* Review Actions Toolbar (when in Review Mode) */}
      {isReviewMode && !isEditing && !isFlagging && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-end gap-2">
          {item.reviewState !== 'approved' && onApprove && (
            <button
              type="button"
              data-testid="approve-item-btn"
              onClick={() => onApprove(item.id, item.rowVersion)}
              disabled={loading}
              className="px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors"
            >
              Approve
            </button>
          )}

          {item.reviewState !== 'rejected' && onReject && (
            <button
              type="button"
              onClick={() => onReject(item.id, item.rowVersion)}
              disabled={loading}
              className="px-2.5 py-1 text-xs font-medium text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors"
            >
              Reject
            </button>
          )}

          {onEdit && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              disabled={loading}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors"
            >
              Edit
            </button>
          )}

          {onFlag && (
            <button
              type="button"
              onClick={() => setIsFlagging(true)}
              disabled={loading}
              className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded transition-colors"
            >
              Flag
            </button>
          )}
        </div>
      )}
    </div>
  );
};
