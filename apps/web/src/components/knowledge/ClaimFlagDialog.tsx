import React, { useState } from 'react';
import type { ClaimDetail, ClaimSummary } from '@relay/contracts';

interface Props {
  claim: ClaimDetail | ClaimSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    claimId: string,
    reason: string,
    newState: 'needs_confirmation' | 'conflicting'
  ) => Promise<void>;
}

export const ClaimFlagDialog: React.FC<Props> = ({ claim, isOpen, onClose, onSubmit }) => {
  const [reason, setReason] = useState('');
  const [newState, setNewState] = useState<'needs_confirmation' | 'conflicting'>(
    'needs_confirmation'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !claim) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason for flagging this claim');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(claim.id, reason.trim(), newState);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit flag');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900">Flag Claim</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
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

        <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 italic">
          &ldquo;{claim.statement}&rdquo;
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              New Evidence State
            </label>
            <select
              value={newState}
              onChange={(e) => setNewState(e.target.value as any)}
              className="w-full text-sm px-3 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 bg-white"
            >
              <option value="needs_confirmation">Needs Confirmation (Doubtful / Incomplete)</option>
              <option value="conflicting">Conflicting (Direct Contradiction)</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Flagging can only lower evidence strength, never raise it.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason for Flag
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this claim's evidence is in doubt or conflicting..."
              className="w-full text-sm p-2.5 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Flagging...' : 'Submit Flag'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
