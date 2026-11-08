import React, { useState, useRef } from 'react';
import { ReviewerAttestation } from './ReviewerAttestation.js';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
  recipientName: string;
  itemCount: number;
}

export const ApprovalDialog: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfirm,
  recipientName,
  itemCount,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { isOpen, onClose });

  const [attestationChecked, setAttestationChecked] = useState(false);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attestationChecked || loading) return;

    setLoading(true);
    try {
      await onConfirm(comment);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-dialog-title"
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 overflow-hidden"
      >
        <h2 id="approval-dialog-title" className="text-lg font-semibold text-slate-900 mb-2">
          Approve Handover Draft
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Approving this draft will lock all {itemCount} items and create an immutable approved
          version ready to be shared with{' '}
          <strong className="text-slate-900">{recipientName}</strong>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <ReviewerAttestation
            recipientName={recipientName}
            checked={attestationChecked}
            onChange={setAttestationChecked}
            disabled={loading}
          />

          <div>
            <label
              htmlFor="approval-comment"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1"
            >
              Approval Notes (Optional)
            </label>
            <textarea
              id="approval-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add any sign-off notes or context for the audit record..."
              className="w-full text-sm rounded-lg border border-slate-300 p-2.5 focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              disabled={loading}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!attestationChecked || loading}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Approving...' : 'Confirm & Approve'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
