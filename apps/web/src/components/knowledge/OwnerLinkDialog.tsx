import React, { useState, useEffect } from 'react';
import type { ClaimDetail, ClaimSummary } from '@relay/contracts';
import { apiFetch } from '../../lib/api.js';

interface ProjectMember {
  userId: string;
  role: string;
  displayName: string;
  email?: string;
  active: boolean;
}

interface Props {
  claim: ClaimDetail | ClaimSummary | null;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (claimId: string, userId: string | null) => Promise<void>;
}

export const OwnerLinkDialog: React.FC<Props> = ({
  claim,
  projectId,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && projectId) {
      setLoadingMembers(true);
      apiFetch<ProjectMember[]>(`/projects/${projectId}/members`)
        .then((data) => {
          setMembers(data.filter((m) => m.active));
          if (claim?.ownerUserId) {
            setSelectedUserId(claim.ownerUserId);
          } else {
            setSelectedUserId('');
          }
        })
        .catch((err) => {
          setError(err.message || 'Failed to load project members');
        })
        .finally(() => {
          setLoadingMembers(false);
        });
    }
  }, [isOpen, projectId, claim]);

  if (!isOpen || !claim) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(claim.id, selectedUserId ? selectedUserId : null);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to link owner');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900">Link Claim Owner</h3>
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

        {claim.ownerLabel && (
          <div className="p-2.5 bg-slate-50 rounded border border-slate-200 text-xs text-slate-700">
            <span>Extracted Label in Source: </span>
            <span className="font-semibold text-slate-900">{claim.ownerLabel}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Active Project Member
            </label>
            {loadingMembers ? (
              <div className="text-xs text-slate-500 py-2">Loading members...</div>
            ) : (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 bg-white"
              >
                <option value="">-- No linked user (unassigned) --</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName} ({m.role})
                  </option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Linking an owner audits the action and connects the claim to a verified account.
            </p>
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
              disabled={submitting || loadingMembers}
              className="px-4 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Confirm Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
