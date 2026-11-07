import React, { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { apiFetch } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.js';

export interface ProjectMemberRow {
  userId?: string;
  user_id?: string;
  id?: string;
  displayName?: string | null;
  email?: string | null;
  role: 'owner' | 'reviewer' | 'contributor' | 'recipient';
  active?: boolean;
  is_active?: boolean;
  user?: {
    id: string;
    displayName?: string | null;
  } | null;
}

export interface ProjectMembersTableProps {
  projectId: string;
  members: ProjectMemberRow[];
  canManage: boolean;
  currentUserId?: string;
  onRefresh: () => void;
}

export const ProjectMembersTable: React.FC<ProjectMembersTableProps> = ({
  projectId,
  members,
  canManage,
  currentUserId,
  onRefresh,
}) => {
  const { addToast } = useToast();
  const [memberToRemove, setMemberToRemove] = useState<ProjectMemberRow | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingUserId(userId);
    try {
      await apiFetch(`/projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      addToast('Member role updated successfully', 'success');
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update member role';
      addToast(msg, 'error');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleRemove = async () => {
    if (!memberToRemove) return;
    const targetUserId = memberToRemove.userId || memberToRemove.user_id || '';
    try {
      await apiFetch(`/projects/${projectId}/members/${targetUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: memberToRemove.role, active: false }),
      });
      addToast('Member removed from project', 'success');
      setMemberToRemove(null);
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove member';
      addToast(msg, 'error');
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="min-w-full divide-y divide-[var(--color-border)] text-left text-sm">
        <thead className="bg-[var(--color-surface-hover)]">
          <tr>
            <th scope="col" className="px-6 py-3 font-semibold text-[var(--color-text)]">
              Member
            </th>
            <th scope="col" className="px-6 py-3 font-semibold text-[var(--color-text)]">
              Role
            </th>
            <th scope="col" className="px-6 py-3 font-semibold text-[var(--color-text)]">
              Status
            </th>
            {canManage && (
              <th
                scope="col"
                className="px-6 py-3 text-right font-semibold text-[var(--color-text)]"
              >
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)] bg-[var(--color-surface)]">
          {members.map((member, index) => {
            const targetId = member.userId || member.user_id || member.id || `member-${index}`;
            const isMe = targetId === currentUserId;
            const displayName =
              member.displayName || member.user?.displayName || `User (${targetId.slice(0, 8)}...)`;
            const isActive = member.active ?? member.is_active ?? true;

            return (
              <tr key={targetId} className="hover:bg-[var(--color-surface-hover)]">
                <td className="whitespace-nowrap px-6 py-4 font-medium text-[var(--color-text)]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span>{displayName}</span>
                      {isMe && (
                        <span className="rounded bg-[var(--color-primary-subtle)] px-2 py-0.5 text-xs text-[var(--color-primary)] font-semibold">
                          You
                        </span>
                      )}
                    </div>
                    {member.email && (
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {member.email}
                      </div>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-[var(--color-text-muted)]">
                  {canManage ? (
                    <select
                      value={member.role}
                      disabled={updatingUserId === targetId}
                      onChange={(e) => handleRoleChange(targetId, e.target.value)}
                      className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                    >
                      <option value="owner">Owner</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="contributor">Contributor</option>
                      <option value="recipient">Recipient</option>
                    </select>
                  ) : (
                    <span className="capitalize">{member.role}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  {isActive ? (
                    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                      Inactive
                    </span>
                  )}
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => setMemberToRemove(member)}
                        className="text-xs font-medium text-red-600 hover:text-red-800 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmDialog
        isOpen={Boolean(memberToRemove)}
        title="Remove Member"
        message="Are you sure you want to remove this member from the project? They will immediately lose access."
        confirmLabel="Remove Member"
        isDestructive
        onConfirm={handleRemove}
        onCancel={() => setMemberToRemove(null)}
      />
    </div>
  );
};
