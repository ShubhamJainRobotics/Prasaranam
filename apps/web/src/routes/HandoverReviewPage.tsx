import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { ErrorState } from '../components/ui/ErrorState.js';
import { HandoverVersionSelector } from '../components/handover/HandoverVersionSelector.js';
import { HandoverReviewToolbar } from '../components/handover/HandoverReviewToolbar.js';
import { HandoverSection } from '../components/handover/HandoverSection.js';
import { ApprovalDialog } from '../components/handover/ApprovalDialog.js';
import { ShareDialog } from '../components/handover/ShareDialog.js';
import { StaleHandoverNotice } from '../components/handover/StaleHandoverNotice.js';
import { ReviewCommentPanel } from '../components/handover/ReviewCommentPanel.js';
import { RecipientPreview } from '../components/handover/RecipientPreview.js';
import { EvidenceDrawer } from '../components/knowledge/EvidenceDrawer.js';
import { api } from '../lib/api.js';
import { useToast } from '../context/ToastContext.js';
import type {
  HandoverDetail,
  HandoverSummary,
  HandoverItemClaimCitation,
  ReviewRecord,
  ClaimSummary,
} from '@relay/contracts';

export const HandoverReviewPage: React.FC = () => {
  const { handoverId } = useParams<{ handoverId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [handover, setHandover] = useState<HandoverDetail | null>(null);
  const [versions, setVersions] = useState<HandoverSummary[]>([]);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals & Panels
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isRecipientPreview, setIsRecipientPreview] = useState(false);

  // Evidence Drawer state
  const [selectedClaimForEvidence, setSelectedClaimForEvidence] = useState<ClaimSummary | null>(
    null
  );
  const [isEvidenceDrawerOpen, setIsEvidenceDrawerOpen] = useState(false);

  // Add Item Modal state
  const [addItemSection, setAddItemSection] = useState<string | null>(null);
  const [addItemText, setAddItemText] = useState('');
  const [addItemKind, setAddItemKind] = useState<'fact' | 'suggestion' | 'unknown'>('fact');
  const [availableClaims, setAvailableClaims] = useState<ClaimSummary[]>([]);
  const [selectedClaimIds, setSelectedClaimIds] = useState<string[]>([]);
  const [addingItem, setAddingItem] = useState(false);

  // Add Context Modal state
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [contextTitle, setContextTitle] = useState('');
  const [contextContent, setContextContent] = useState('');
  const [contextFormat, setContextFormat] = useState<'text' | 'markdown'>('markdown');
  const [contextVisibility, setContextVisibility] = useState<'project' | 'restricted'>(
    'restricted'
  );
  const [addingContext, setAddingContext] = useState(false);

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

        // Fetch review history
        const revRes = await api.get<ReviewRecord[] | { data: ReviewRecord[] }>(
          `/handovers/${id}/reviews`
        );
        const rList = Array.isArray(revRes)
          ? revRes
          : revRes && 'data' in revRes && Array.isArray(revRes.data)
            ? revRes.data
            : [];
        setReviews(rList);
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load handover');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!handoverId) return;
    setLoading(true);
    setError(null);
    fetchHandover(handoverId);
  }, [handoverId]);

  // Load available claims for adding items
  const openAddItemModal = async (sectionKey: string) => {
    setAddItemSection(sectionKey);
    setAddItemText('');
    setAddItemKind(sectionKey === 'next_actions' ? 'suggestion' : 'fact');
    setSelectedClaimIds([]);

    if (handover?.projectId) {
      try {
        const claimsRes = await api.get<{ claims?: ClaimSummary[] }>(
          `/projects/${handover.projectId}/claims`
        );
        if (claimsRes?.claims) {
          setAvailableClaims(claimsRes.claims);
        }
      } catch {
        // Fallback
      }
    }
  };

  // Item Actions
  const handleApproveItem = async (itemId: string, rowVersion: number) => {
    if (!handoverId) return;
    try {
      await api.patch(
        `/handovers/${handoverId}/items/${itemId}`,
        { reviewState: 'approved' },
        { headers: { 'If-Match': String(rowVersion) } }
      );
      showToast('Item approved', 'success');
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to approve item', 'error');
    }
  };

  const handleRejectItem = async (itemId: string, rowVersion: number) => {
    if (!handoverId) return;
    try {
      await api.patch(
        `/handovers/${handoverId}/items/${itemId}`,
        { reviewState: 'rejected' },
        { headers: { 'If-Match': String(rowVersion) } }
      );
      showToast('Item rejected', 'success');
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to reject item', 'error');
    }
  };

  const handleEditItem = async (itemId: string, newText: string, rowVersion: number) => {
    if (!handoverId) return;
    try {
      await api.patch(
        `/handovers/${handoverId}/items/${itemId}`,
        { text: newText },
        { headers: { 'If-Match': String(rowVersion) } }
      );
      showToast('Item updated', 'success');
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to update item', 'error');
    }
  };

  const handleFlagItem = async (itemId: string, reason: string) => {
    if (!handoverId) return;
    try {
      await api.patch(`/handovers/${handoverId}/items/${itemId}`, {
        comment: reason,
        reviewState: 'pending',
      });
      showToast('Item flagged and evidence downgraded', 'success');
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to flag item', 'error');
    }
  };

  // Add Item Submit
  const handleSaveNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverId || !addItemSection || !addItemText.trim()) return;

    setAddingItem(true);
    try {
      await api.post(`/handovers/${handoverId}/items`, {
        section: addItemSection,
        text: addItemText.trim(),
        itemKind: addItemKind,
        claimIds: selectedClaimIds,
      });
      showToast('New item added to draft', 'success');
      setAddItemSection(null);
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to add item', 'error');
    } finally {
      setAddingItem(false);
    }
  };

  // Add Context Submit
  const handleSaveContext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverId || !contextTitle.trim() || !contextContent.trim()) return;

    setAddingContext(true);
    try {
      await api.post(`/handovers/${handoverId}/context`, {
        title: contextTitle.trim(),
        content: contextContent.trim(),
        format: contextFormat,
        visibility: contextVisibility,
      });
      showToast('Reviewer context added and extraction queued', 'success');
      setIsContextModalOpen(false);
      setContextTitle('');
      setContextContent('');
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to add context', 'error');
    } finally {
      setAddingContext(false);
    }
  };

  // Approval Submit
  const handleConfirmApproval = async (comment: string) => {
    if (!handoverId) return;
    try {
      await api.post(`/handovers/${handoverId}/approve`, {
        confirmReviewedForRecipient: true,
        comment: comment || undefined,
      });
      showToast('Handover approved successfully!', 'success');
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to approve handover', 'error');
      throw err;
    }
  };

  // Share Submit
  const handleConfirmShare = async () => {
    if (!handoverId) return;
    try {
      await api.post(`/handovers/${handoverId}/share`, {});
      showToast('Handover shared with recipient successfully!', 'success');
      await fetchHandover(handoverId);
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to share handover', 'error');
      throw err;
    }
  };

  // Revision Create
  const handleCreateRevision = async () => {
    if (!handoverId) return;
    try {
      const res = await api.post<{
        handoverId?: string;
        version?: number;
        data?: { handoverId?: string; version?: number };
      }>(`/handovers/${handoverId}/versions`, {});
      const resData = res?.data || res;
      if (resData?.version !== undefined) {
        showToast(`Revision v${resData.version} created`, 'success');
      }
      if (resData?.handoverId) {
        navigate(`/app/handovers/${resData.handoverId}/review`);
      }
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to create revision', 'error');
    }
  };

  // Citation Click
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
        <LoadingSkeleton lines={6} />
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

  const items = handover.items || [];
  const totalItems = items.length;
  const reviewedItems = items.filter((i) => i.reviewState !== 'pending').length;
  const approvedItems = items.filter((i) => i.reviewState === 'approved').length;

  // Group items by section
  const sectionKeys = handover.configuration.includedSections || [];
  const itemsBySection = new Map<string, typeof items>();
  for (const sk of sectionKeys) {
    itemsBySection.set(sk, []);
  }
  for (const item of items) {
    const list = itemsBySection.get(item.section) || [];
    list.push(item);
    itemsBySection.set(item.section, list);
  }

  const reviewContent = (
    <div className="space-y-6">
      {handover.isStale && (
        <StaleHandoverNotice reasonCode={handover.reasonCode} isRecipient={false} />
      )}

      {/* Render sections */}
      <div className="space-y-6">
        {sectionKeys.map((secKey) => (
          <HandoverSection
            key={secKey}
            sectionKey={secKey}
            title={secKey}
            items={itemsBySection.get(secKey) || []}
            isReviewMode={!isRecipientPreview && handover.status === 'draft'}
            onApproveItem={handleApproveItem}
            onRejectItem={handleRejectItem}
            onEditItem={handleEditItem}
            onFlagItem={handleFlagItem}
            onSelectCitation={handleSelectCitation}
            onOpenAddItemModal={openAddItemModal}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16">
      {/* Top Header Section */}
      <div className="bg-white border-b border-slate-200 px-8 py-5">
        <div className="max-w-6xl mx-auto space-y-3">
          <Breadcrumbs
            items={[
              { label: 'Projects', href: '/app' },
              { label: 'Project', href: `/app/projects/${handover.projectId}/dashboard` },
              { label: 'Handovers', href: `/app/projects/${handover.projectId}/handovers` },
              { label: `Review (v${handover.version})` },
            ]}
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200">
                  Version {handover.version}
                </span>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase ${
                    handover.status === 'shared'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : handover.status === 'approved'
                        ? 'bg-teal-50 text-teal-800 border border-teal-200'
                        : handover.status === 'stale' || handover.status === 'superseded'
                          ? 'bg-slate-100 text-slate-600 border border-slate-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {handover.status}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">{handover.title}</h1>
              <p className="text-xs text-slate-500 mt-1">
                Prepared for recipient:{' '}
                <strong className="text-slate-800 font-semibold">
                  {handover.recipientName || 'Incoming Member'}
                </strong>
                {handover.departingUserName && (
                  <>
                    {' '}
                    • Departing:{' '}
                    <strong className="text-slate-800">{handover.departingUserName}</strong>
                  </>
                )}
              </p>
            </div>

            <HandoverVersionSelector
              versions={versions}
              activeId={handover.id}
              onSelect={(id) => navigate(`/app/handovers/${id}/review`)}
            />
          </div>
        </div>
      </div>

      {/* Sticky Review Action Bar */}
      <HandoverReviewToolbar
        status={handover.status}
        totalItems={totalItems}
        reviewedItems={reviewedItems}
        approvedItems={approvedItems}
        isRecipientPreview={isRecipientPreview}
        onToggleRecipientPreview={() => setIsRecipientPreview(!isRecipientPreview)}
        onOpenApprovalModal={() => setIsApprovalOpen(true)}
        onOpenShareModal={() => setIsShareOpen(true)}
        onCreateRevision={handleCreateRevision}
        onOpenAddContextModal={() => setIsContextModalOpen(true)}
        onOpenAuditDrawer={() => setIsAuditOpen(true)}
      />

      {/* Main Review Workbench */}
      <div className="max-w-6xl mx-auto px-8 py-6">
        {isRecipientPreview ? (
          <RecipientPreview
            recipientName={handover.recipientName || 'Incoming Member'}
            onExit={() => setIsRecipientPreview(false)}
          >
            {reviewContent}
          </RecipientPreview>
        ) : (
          reviewContent
        )}
      </div>

      {/* Modals & Drawers */}
      <ApprovalDialog
        isOpen={isApprovalOpen}
        onClose={() => setIsApprovalOpen(false)}
        onConfirm={handleConfirmApproval}
        recipientName={handover.recipientName || 'Incoming Member'}
        itemCount={approvedItems}
      />

      <ShareDialog
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        onConfirm={handleConfirmShare}
        recipientName={handover.recipientName || 'Incoming Member'}
        version={handover.version}
      />

      <ReviewCommentPanel
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        reviews={reviews}
      />

      <EvidenceDrawer
        claim={selectedClaimForEvidence}
        isOpen={isEvidenceDrawerOpen}
        onClose={() => setIsEvidenceDrawerOpen(false)}
      />

      {/* Add Item Modal */}
      {addItemSection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Add Item to Section: <span className="uppercase text-teal-800">{addItemSection}</span>
            </h3>

            <form onSubmit={handleSaveNewItem} className="space-y-4">
              <div>
                <label
                  htmlFor="add-item-kind"
                  className="block text-xs font-semibold uppercase text-slate-500 mb-1"
                >
                  Item Kind
                </label>
                <select
                  id="add-item-kind"
                  value={addItemKind}
                  onChange={(e) => setAddItemKind(e.target.value as any)}
                  className="w-full text-sm rounded-lg border border-slate-300 p-2.5 bg-white"
                >
                  <option value="fact">Fact (requires claim links)</option>
                  <option value="suggestion">Suggestion (requires claim links)</option>
                  <option value="unknown">Unknown (missing info)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="add-item-statement"
                  className="block text-xs font-semibold uppercase text-slate-500 mb-1"
                >
                  Item Statement *
                </label>
                <textarea
                  id="add-item-statement"
                  rows={3}
                  value={addItemText}
                  onChange={(e) => setAddItemText(e.target.value)}
                  placeholder="Enter the item wording..."
                  className="w-full text-sm rounded-lg border border-slate-300 p-2.5"
                  required
                />
              </div>

              {addItemKind !== 'unknown' && (
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                    Select Supporting Accessible Claims (at least 1 required)
                  </label>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                    {availableClaims.map((c) => {
                      const isChecked = selectedClaimIds.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer p-1.5 rounded hover:bg-slate-200/60"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedClaimIds([...selectedClaimIds, c.id]);
                              } else {
                                setSelectedClaimIds(selectedClaimIds.filter((id) => id !== c.id));
                              }
                            }}
                            className="mt-0.5 rounded text-teal-700"
                          />
                          <div>
                            <span className="font-semibold text-slate-900 block">
                              {c.statement}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              [{c.kind} • {c.evidenceState}]
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddItemSection(null)}
                  disabled={addingItem}
                  className="px-3.5 py-1.5 text-xs text-slate-600 bg-white border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    addingItem ||
                    !addItemText.trim() ||
                    (addItemKind !== 'unknown' && selectedClaimIds.length === 0)
                  }
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-50"
                >
                  {addingItem ? 'Adding...' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Reviewer Context Modal */}
      {isContextModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Add Reviewer Context Source</h3>
            <p className="text-xs text-slate-500">
              Add authoritative notes or clarification evidence. Prasaranam will ingest this as an
              explicit source and enqueue its extraction.
            </p>

            <form onSubmit={handleSaveContext} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Context Title *
                </label>
                <input
                  type="text"
                  value={contextTitle}
                  onChange={(e) => setContextTitle(e.target.value)}
                  placeholder="e.g. Dana Vance Departure Architecture Clarification"
                  className="w-full text-sm rounded-lg border border-slate-300 p-2.5"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Notes & Details (Markdown) *
                </label>
                <textarea
                  rows={5}
                  value={contextContent}
                  onChange={(e) => setContextContent(e.target.value)}
                  placeholder="Enter context notes..."
                  className="w-full text-sm rounded-lg border border-slate-300 p-2.5 font-mono text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="context-visibility"
                    className="block text-xs font-semibold uppercase text-slate-500 mb-1"
                  >
                    Visibility Policy
                  </label>
                  <select
                    id="context-visibility"
                    value={contextVisibility}
                    onChange={(e) => setContextVisibility(e.target.value as any)}
                    className="w-full text-xs rounded-lg border border-slate-300 p-2 bg-white"
                  >
                    <option value="restricted">Restricted (Author & Recipient)</option>
                    <option value="project">Project (All members)</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="context-format"
                    className="block text-xs font-semibold uppercase text-slate-500 mb-1"
                  >
                    Format
                  </label>
                  <select
                    id="context-format"
                    value={contextFormat}
                    onChange={(e) => setContextFormat(e.target.value as any)}
                    className="w-full text-xs rounded-lg border border-slate-300 p-2 bg-white"
                  >
                    <option value="markdown">Markdown</option>
                    <option value="text">Plain Text</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsContextModalOpen(false)}
                  disabled={addingContext}
                  className="px-3.5 py-1.5 text-xs text-slate-600 bg-white border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingContext || !contextTitle.trim() || !contextContent.trim()}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-50"
                >
                  {addingContext ? 'Importing...' : 'Import & Enqueue Extraction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
