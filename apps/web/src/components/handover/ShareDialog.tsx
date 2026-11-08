import React, { useState, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  recipientName: string;
  version: number;
}

export const ShareDialog: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfirm,
  recipientName,
  version,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { isOpen, onClose });

  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleShare = async () => {
    setLoading(true);
    try {
      await onConfirm();
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
      aria-labelledby="share-dialog-title"
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-teal-700">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
          </div>
          <div>
            <h2 id="share-dialog-title" className="text-lg font-semibold text-slate-900">
              Share Handover (v{version})
            </h2>
            <p className="text-xs text-slate-500">Immediate access grant</p>
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          Sharing will make this approved handover immediately available to{' '}
          <strong className="text-slate-900">{recipientName}</strong>. Any earlier shared versions
          of this handover will be marked{' '}
          <span className="font-semibold text-amber-700">superseded</span> and will no longer be
          viewable by the recipient.
        </p>

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
            type="button"
            onClick={handleShare}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Sharing...' : 'Share Handover'}
          </button>
        </div>
      </div>
    </div>
  );
};
