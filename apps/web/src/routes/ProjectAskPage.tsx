import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { ChatPanel } from '../components/qa/ChatPanel.js';
import { api, RelayApiError } from '../lib/api.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ErrorState } from '../components/ui/ErrorState.js';

interface ProjectInfo {
  id: string;
  name: string;
  description?: string | null;
  organisationId: string;
}

export const ProjectAskPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const fetchProject = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.get<ProjectInfo>(`/projects/${projectId}`);
        setProject(data);
      } catch (err) {
        const apiErr = err as RelayApiError;
        setError(apiErr.message || 'Failed to load project details');
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton lines={3} />
      </div>
    );
  }

  if (error || !project || !projectId) {
    return (
      <ErrorState title="Project Not Found" message={error || 'Could not load project for Q&A'} />
    );
  }

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/app' },
          { label: project.name, href: `/app/projects/${projectId}` },
          { label: 'Ask Relay' },
        ]}
      />

      <PageHeader
        title="Ask Relay"
        description="Query project knowledge with strict evidence grounding. Answers cite only sources you are permitted to read."
      />

      <ChatPanel projectId={projectId} />
    </div>
  );
};
