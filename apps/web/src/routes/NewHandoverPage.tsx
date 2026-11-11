import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ErrorState } from '../components/ui/ErrorState.js';
import { HandoverConfigurationForm } from '../components/handover/HandoverConfigurationForm.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import type { CreateHandoverInput } from '@relay/contracts';

interface MemberDef {
  userId: string;
  displayName: string;
  role: string;
}

interface JobPollResponse {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result?: { handoverId?: string };
  lastErrorCode?: string;
}

export const NewHandoverPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [members, setMembers] = useState<MemberDef[]>([]);
  const [projectName, setProjectName] = useState<string>('Project');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>('queued');

  useEffect(() => {
    if (!projectId) return;

    let mounted = true;
    async function loadMembers() {
      setLoading(true);
      setError(null);
      try {
        const [projRes, memRes] = await Promise.all([
          api.get<{ project?: { name: string }; name?: string }>(`/projects/${projectId}`),
          api.get<{ members?: MemberDef[] } | MemberDef[]>(`/projects/${projectId}/members`),
        ]);

        if (mounted) {
          const name = projRes?.project?.name || projRes?.name;
          if (name) {
            setProjectName(name);
          }
          if (Array.isArray(memRes)) {
            setMembers(memRes);
          } else if (memRes && 'members' in memRes && Array.isArray(memRes.members)) {
            setMembers(memRes.members);
          }
        }
      } catch (err: unknown) {
        if (mounted) {
          setError((err as Error).message || 'Failed to load project members');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadMembers();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  // Polling for handover generation job
  useEffect(() => {
    if (!activeJobId) return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const job = await api.get<JobPollResponse | { data: JobPollResponse }>(
          `/jobs/${activeJobId}`
        );
        const jobData = (
          job && 'data' in job ? (job as { data: JobPollResponse }).data : job
        ) as JobPollResponse;

        if (!active) return;
        setJobStatus(jobData.status);

        if (jobData.status === 'succeeded') {
          clearInterval(interval);
          showToast('Handover draft generated successfully!', 'success');
          const handoverId = jobData.result?.handoverId;
          if (handoverId) {
            navigate(`/app/handovers/${handoverId}/review`);
          } else {
            navigate(`/app/projects/${projectId}/handovers`);
          }
        } else if (jobData.status === 'failed' || jobData.status === 'cancelled') {
          clearInterval(interval);
          setError(`Handover generation failed: ${jobData.lastErrorCode || 'Unknown error'}`);
          setActiveJobId(null);
          setSubmitting(false);
        }
      } catch {
        // Continue polling unless explicitly unmounted
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeJobId, navigate, projectId, showToast]);

  const handleSubmit = async (data: CreateHandoverInput) => {
    if (!projectId) return;
    setSubmitting(true);
    setError(null);

    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await api.post<{ jobId?: string; data?: { jobId?: string } }>(
        `/projects/${projectId}/handovers`,
        data,
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        }
      );

      const jobId = res?.jobId || res?.data?.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        showToast('Handover generation queued', 'success');
      } else {
        throw new Error('Failed to obtain generation job ID');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to queue handover generation');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <LoadingSkeleton lines={5} />
      </div>
    );
  }

  if (error && !submitting) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/app' },
          { label: projectName, href: `/app/projects/${projectId}` },
          { label: 'Handovers', href: `/app/projects/${projectId}/handovers` },
          { label: 'New Handover' },
        ]}
      />

      <PageHeader
        title="Configure Handover Generation"
        description="Select recipient and sections. Prasaranam will synthesize an actionable draft using only evidence accessible to both you and the recipient."
      />

      {activeJobId ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs space-y-6 text-center">
          <div className="w-12 h-12 border-3 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-slate-900">
              Synthesizing Evidence & Generating Handover Draft...
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Prasaranam is assembling authorized claims, validating evidence quotations, and
              compiling structured sections for the recipient.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-700">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
            Status: <span className="uppercase font-bold tracking-wide">{jobStatus}</span>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs">
          <HandoverConfigurationForm
            members={members}
            currentUserId={user?.id || ''}
            onSubmit={handleSubmit}
            loading={submitting}
          />
        </div>
      )}
    </div>
  );
};
