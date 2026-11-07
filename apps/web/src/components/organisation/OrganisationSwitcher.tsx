import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateOrgDialog } from './CreateOrgDialog.js';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role?: string;
}

export interface OrganisationSwitcherProps {
  organisations: OrgSummary[];
  currentOrgId?: string;
  onOrgCreated?: (org: OrgSummary) => void;
}

export const OrganisationSwitcher: React.FC<OrganisationSwitcherProps> = ({
  organisations,
  currentOrgId,
  onOrgCreated,
}) => {
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === '__new__') {
      setIsCreateOpen(true);
    } else if (value && value !== currentOrgId) {
      navigate(`/app/organisations/${value}`);
    }
  };

  return (
    <div className="w-full">
      <label
        htmlFor="org-switcher"
        className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
      >
        Organisation
      </label>
      <div className="relative">
        <select
          id="org-switcher"
          value={currentOrgId || ''}
          onChange={handleChange}
          className="block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1.5 pl-3 pr-8 text-sm font-medium text-[var(--color-text)] shadow-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        >
          {organisations.length === 0 && (
            <option value="" disabled>
              No organisations
            </option>
          )}
          {organisations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
          <option value="__new__">+ New Organisation...</option>
        </select>
      </div>

      <CreateOrgDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(org) => {
          if (onOrgCreated) onOrgCreated(org);
          navigate(`/app/organisations/${org.id}`);
        }}
      />
    </div>
  );
};
