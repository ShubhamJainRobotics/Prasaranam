import React, { useState } from 'react';
import type { HandoverItem as HandoverItemType, HandoverItemClaimCitation } from '@relay/contracts';
import { HandoverItem } from './HandoverItem.js';

interface Props {
  sectionKey: string;
  title: string;
  items: HandoverItemType[];
  isReviewMode?: boolean;
  onApproveItem?: (itemId: string, rowVersion: number) => Promise<void>;
  onRejectItem?: (itemId: string, rowVersion: number) => Promise<void>;
  onEditItem?: (itemId: string, newText: string, rowVersion: number) => Promise<void>;
  onFlagItem?: (itemId: string, reason: string) => Promise<void>;
  onSelectCitation?: (citation: HandoverItemClaimCitation) => void;
  onOpenAddItemModal?: (sectionKey: string) => void;
}

const SECTION_LABELS: Record<string, { label: string; description: string }> = {
  snapshot: {
    label: 'Project Snapshot',
    description: 'Executive overview, primary architecture choices, and project direction',
  },
  decisions: {
    label: 'Decisions & Rationale',
    description: 'Validated architecture and operational choices with supporting reasons',
  },
  work_in_progress: {
    label: 'Work in Progress',
    description: 'Active tasks, ongoing implementations, and open work streams',
  },
  owners_contacts: {
    label: 'Owners & Contacts',
    description: 'Key contacts, system owners, and domain responsibilities',
  },
  risks_dependencies: {
    label: 'Risks & Dependencies',
    description: 'Identified technical risks, external dependencies, and active blockers',
  },
  open_questions: {
    label: 'Open Questions',
    description: 'Missing information, unverified gaps, and points for clarification',
  },
  next_actions: {
    label: 'Suggested Next Actions',
    description: 'Recommended follow-ups and priority next steps for the incoming team',
  },
};

export const HandoverSection: React.FC<Props> = ({
  sectionKey,
  items,
  isReviewMode = false,
  onApproveItem,
  onRejectItem,
  onEditItem,
  onFlagItem,
  onSelectCitation,
  onOpenAddItemModal,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const sectionMeta = SECTION_LABELS[sectionKey] || {
    label: sectionKey.replace(/_/g, ' ').toUpperCase(),
    description: '',
  };

  return (
    <div className="bg-slate-50/50 border border-slate-200/80 rounded-2xl p-5 transition-all">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-3 text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-teal-100/70 text-teal-800 flex items-center justify-center font-bold text-xs">
            {items.length}
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900 group-hover:text-teal-700 transition-colors flex items-center gap-2">
              {sectionMeta.label}
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </h3>
            {sectionMeta.description && (
              <p className="text-xs text-slate-500 mt-0.5">{sectionMeta.description}</p>
            )}
          </div>
        </button>

        {isReviewMode && onOpenAddItemModal && (
          <button
            type="button"
            onClick={() => onOpenAddItemModal(sectionKey)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Item
          </button>
        )}
      </div>

      {/* Items list */}
      {isExpanded && (
        <div className="space-y-3 mt-3">
          {items.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-500 bg-white border border-dashed border-slate-200 rounded-xl">
              No items in this section.
            </div>
          ) : (
            items.map((item) => (
              <HandoverItem
                key={item.id}
                item={item}
                isReviewMode={isReviewMode}
                onApprove={onApproveItem}
                onReject={onRejectItem}
                onEdit={onEditItem}
                onFlag={onFlagItem}
                onSelectCitation={onSelectCitation}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
