import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, RelayApiError } from '../lib/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.js';
import { AddOrgMemberDialog } from '../components/organisation/AddMemberDialog.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { NotFoundPage } from './NotFoundPage.js';

interface OrgMember {
  userId: string;
  displayName: string | null;
  role: 'owner' | 'admin' | 'member';
  active: boolean;
  email?: string;
  createdAt: string;
}

interface MeResponse {
  organisations: Array<{ id: string; name: string; role: string }>;
}

export const OrganisationMembersPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [orgName, setOrgName] = useState<string>('Organisation');
  const [callerRole, setCallerRole] = useState<string>('member');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [memberToDeactivate, setMemberToDeactivate] = useState<OrgMember | null>(null);

  const loadMembers = useCallback(async () => {
    if (!organisationId) return;
    try {
      const me = await apiFetch<MeResponse>('/me');
      const foundOrg = me.organisations?.find((o) => o.id === organisationId);
      if (!foundOrg) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setOrgName(foundOrg.name);
      setCallerRole(foundOrg.role);

      const res = await apiFetch<OrgMember[]>(`/organisations/${organisationId}/members`);
      setMembers(res || []);
    } catch (err) {
      if (err instanceof RelayApiError && err.status === 404) {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [organisationId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  if (notFound) {
    return <NotFoundPage />;
  }

  if (loading) {
    return <LoadingSkeleton lines={8} />;
  }

  const canManage = callerRole === 'owner' || callerRole === 'admin';

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await apiFetch(`/organisations/${organisationId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      addToast('Member role updated successfully', 'success');
      loadMembers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update member role';
      addToast(msg, 'error');
    }
  };

  const handleDeactivate = async () => {
    if (!memberToDeactivate || !organisationId) return;
    try {
      await apiFetch(`/organisations/${organisationId}/members/${memberToDeactivate.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      });
      addToast('Member deactivated from organisation', 'success');
      setMemberToDeactivate(null);
      loadMembers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to deactivate member';
      addToast(msg, 'error');
    }
  };

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Organisations', href: '/app' },
          { label: orgName, href: `/app/organisations/${organisationId}` },
          { label: 'Members' },
        ]}
      />

      <PageHeader
        title={`${orgName} Members`}
        description="View and manage organisation membership and administrative access."
        actions={
          canManage ? (
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm"
            >
              + Add Member
            </button>
          ) : undefined
        }
      />

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
            {members.map((member) => {
              const isMe = member.userId === user?.id;
              const nameDisplay = member.displayName || `User (${member.userId.slice(0, 8)})`;

              return (
                <tr key={member.userId} className="hover:bg-[var(--color-surface-hover)]">
                  <td className="whitespace-nowrap px-6 py-4 font-medium text-[var(--color-text)]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span>{nameDisplay}</span>
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
                        onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                        className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    ) : (
                      <span className="capitalize">{member.role}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {member.active ? (
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
                      {member.active && (
                        <button
                          type="button"
                          onClick={() => setMemberToDeactivate(member)}
                          className="text-xs font-medium text-red-600 hover:text-red-800 transition-colors"
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {organisationId && (
        <AddOrgMemberDialog
          orgId={organisationId}
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          onMemberAdded={loadMembers}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(memberToDeactivate)}
        title="Deactivate Member"
        message={`Are you sure you want to deactivate this member from ${orgName}? They will immediately lose access to all projects in this organisation.`}
        confirmLabel="Deactivate"
        isDestructive
        onConfirm={handleDeactivate}
        onCancel={() => setMemberToDeactivate(null)}
      />
    </div>
  );
};
