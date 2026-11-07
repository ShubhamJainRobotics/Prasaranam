import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ErrorState } from '../components/ui/ErrorState.js';
import { HandoverVersionSelector } from '../components/handover/HandoverVersionSelector.js';
import { HandoverSection } from '../components/handover/HandoverSection.js';
import { StaleHandoverNotice } from '../components/handover/StaleHandoverNotice.js';
import { EvidenceDrawer } from '../components/knowledge/EvidenceDrawer.js';
import { api } from '../lib/api.js';
import type {
  HandoverDetail,
  HandoverSummary,
  HandoverItemClaimCitation,
  ClaimSummary,
} from '@relay/contracts';

const ORDERED_SECTIONS = [
  'snapshot',
  'decisions',
  'work_in_progress',
  'owners_contacts',
  'risks_dependencies',
  'open_questions',
  'next_actions',
];

export const HandoverDetailPage: React.FC = () => {
  const { handoverId } = useParams<{ handoverId: string }>();
  const navigate = useNavigate();

  const [handover, setHandover] = useState<HandoverDetail | null>(null);
  const [versions, setVersions] = useState<HandoverSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStaleError, setIsStaleError] = useState(false);

  // Evidence Drawer state
  const [selectedClaimForEvidence, setSelectedClaimForEvidence] = useState<ClaimSummary | null>(
    null
  );
  const [isEvidenceDrawerOpen, setIsEvidenceDrawerOpen] = useState(false);

  const fetchHandover = async (id: string) => {
    try {
      const res = await api.get<HandoverDetail | { data: HandoverDetail }>(`/handovers/${id}`);
      const hData =
        res && 'data' in res ? (res as { data: HandoverDetail }).data : (res as HandoverDetail);
      if (hData) {
        setHandover(hData);

        // Fetch sibling versions under same project
        const versRes = await api.get<HandoverSummary[] | { data: HandoverSummary[] }>(
          `/projects/${hData.projectId}/handovers`
        );
        const vList = Array.isArray(versRes)
          ? versRes
          : versRes && 'data' in versRes && Array.isArray(versRes.data)
            ? versRes.data
            : [];
        const rootVers = vList.filter((v: HandoverSummary) => v.rootId === hData.rootId);
        setVersions(rootVers);
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Failed to load handover';
      if (msg.includes('REGENERATION_REQUIRED') || msg.includes('409') || msg.includes('stale')) {
        setIsStaleError(true);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!handoverId) return;
    setLoading(true);
    setError(null);
    setIsStaleError(false);
    fetchHandover(handoverId);
  }, [handoverId]);

  // Citation click opens supporting evidence drawer
  const handleSelectCitation = (citation: HandoverItemClaimCitation) => {
    setSelectedClaimForEvidence({
      id: citation.claimId,
      projectId: handover?.projectId || '',
      kind: 'decision',
      statement: citation.statement,
      workState: 'open',
      evidenceState: citation.evidenceState,
      ownerLabel: null,
      observedAt: null,
      reviewStatus: 'unreviewed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      evidence: citation.quote
        ? [
            {
              id: crypto.randomUUID(),
              chunkId: citation.chunkId || crypto.randomUUID(),
              sourceId: crypto.randomUUID(),
              sourceTitle: citation.sourceTitle || 'Source Evidence',
              quote: citation.quote,
              quoteStart: citation.quoteStart || 0,
              quoteEnd: citation.quoteEnd || citation.quote.length,
            },
          ]
        : [],
    } as unknown as ClaimSummary);
    setIsEvidenceDrawerOpen(true);
  };

  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <LoadingSkeleton lines={8} />
      </div>
    );
  }

  if (isStaleError || handover?.isStale) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Workspace', href: '/app' },
            { label: 'Handovers' },
            { label: 'Stale Handover' },
          ]}
        />
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
          <StaleHandoverNotice isRecipient={true} reasonCode="REGENERATION_REQUIRED" />
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Project access epoch or cited sources changed.</span>
            <Link
              to="/app"
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
            >
              Return to Workspace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (error || !handover) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <ErrorState message={error || 'Handover not found.'} />
      </div>
    );
  }

  // Group items by section
  const itemsBySection = handover.items.reduce<Record<string, typeof handover.items>>(
    (acc, item) => {
      if (!acc[item.section]) acc[item.section] = [];
      acc[item.section]!.push(item);
      return acc;
    },
    {}
  );

  // Present sections that exist in items or default list
  const activeSections = Array.from(
    new Set([
      ...ORDERED_SECTIONS.filter((s) => (itemsBySection[s]?.length ?? 0) > 0),
      ...Object.keys(itemsBySection),
    ])
  );

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Workspace', href: '/app' },
          { label: 'Project', href: `/app/projects/${handover.projectId}` },
          { label: 'Handovers', href: `/app/projects/${handover.projectId}/handovers` },
          { label: handover.configuration.title },
        ]}
      />

      {/* Main Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                {handover.status}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                v{handover.version}
              </span>
              {handover.sharedAt && (
                <span className="text-xs text-slate-500">
                  Shared on {new Date(handover.sharedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {handover.configuration.title}
            </h1>
            <p className="text-sm text-slate-600">
              Detail:{' '}
              <span className="font-semibold text-slate-800 capitalize">
                {handover.configuration.detailLevel}
              </span>
              {handover.configuration.priorityFocus ? (
                <> &bull; Priority Focus: {handover.configuration.priorityFocus}</>
              ) : null}
            </p>
          </div>

          <div className="flex items-center gap-3 self-start lg:self-center">
            {versions.length > 1 && (
              <HandoverVersionSelector
                versions={versions}
                activeId={handover.id}
                onSelect={(id) => navigate(`/app/handovers/${id}`)}
              />
            )}
            <Link
              to={`/app/handovers/${handover.id}/review`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
              Review / Revisions
            </Link>
          </div>
        </div>

        {/* Handover Summary Banner */}
        <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-slate-400 font-medium">Recipient</div>
            <div className="font-semibold text-slate-700 mt-0.5">
              {handover.recipientName || 'Incoming Team'}
            </div>
          </div>
          <div>
            <div className="text-slate-400 font-medium">Created By</div>
            <div className="font-semibold text-slate-700 mt-0.5">
              {handover.departingUserName || handover.createdBy}
            </div>
          </div>
          <div>
            <div className="text-slate-400 font-medium">Total Items</div>
            <div className="font-semibold text-slate-700 mt-0.5">
              {handover.items.length} verified
            </div>
          </div>
          <div>
            <div className="text-slate-400 font-medium">Access Epoch</div>
            <div className="font-semibold text-slate-700 mt-0.5">
              Epoch {String(handover.approvedAccessEpoch ?? handover.generatedAccessEpoch)}
            </div>
          </div>
        </div>
      </div>

      {/* Handover Sections */}
      <div className="space-y-6">
        {activeSections.length === 0 ? (
          <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
            <p className="text-sm text-slate-500">
              This handover does not contain any approved items.
            </p>
          </div>
        ) : (
          activeSections.map((secKey) => (
            <HandoverSection
              key={secKey}
              sectionKey={secKey}
              title={secKey}
              items={itemsBySection[secKey] || []}
              isReviewMode={false}
              onSelectCitation={handleSelectCitation}
            />
          ))
        )}
      </div>

      {/* Supporting Evidence Drawer */}
      <EvidenceDrawer
        claim={selectedClaimForEvidence}
        isOpen={isEvidenceDrawerOpen}
        onClose={() => {
          setIsEvidenceDrawerOpen(false);
          setSelectedClaimForEvidence(null);
        }}
      />
    </div>
  );
};
