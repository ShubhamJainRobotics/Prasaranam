import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { CreateOrgDialog } from '../components/organisation/CreateOrgDialog.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';

interface MeResult {
  organisations: Array<{ id: string; name: string }>;
  projects: Array<{ id: string }>;
}

export const AppEntryPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasNoOrgs, setHasNoOrgs] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    const checkUserWorkspaces = async () => {
      try {
        const me = await apiFetch<MeResult>('/me');
        if (me.organisations && me.organisations.length > 0 && me.organisations[0]) {
          const firstOrg = me.organisations[0];
          navigate(`/app/organisations/${firstOrg.id}`, { replace: true });
        } else {
          setHasNoOrgs(true);
          setLoading(false);
        }
      } catch {
        setHasNoOrgs(true);
        setLoading(false);
      }
    };

    checkUserWorkspaces();
  }, [navigate]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <LoadingSkeleton lines={6} />
      </div>
    );
  }

  if (hasNoOrgs) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <EmptyState
          title="Welcome to Prasaranam"
          description="You do not belong to any organisations yet. Create your first organisation to get started with projects and handovers."
          action={{
            label: 'Create Organisation',
            onClick: () => setIsCreateOpen(true),
          }}
        />

        <CreateOrgDialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onCreated={(newOrg) => {
            navigate(`/app/organisations/${newOrg.id}`);
          }}
        />
      </div>
    );
  }

  return null;
};
