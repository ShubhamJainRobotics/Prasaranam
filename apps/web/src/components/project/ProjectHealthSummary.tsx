import React from 'react';

interface Props {
  memberCount: number;
  sourceCount: number;
  claimCount: number;
  questionCount?: number;
  handoverCount: number;
  accessEpoch: number;
}

export const ProjectHealthSummary: React.FC<Props> = ({
  memberCount,
  sourceCount,
  claimCount,
  questionCount = 0,
  handoverCount,
  accessEpoch,
}) => {
  const hasSources = sourceCount > 0;
  const hasClaims = claimCount > 0;
  const hasHandovers = handoverCount > 0;

  let readinessLevel = 'Initial Setup';
  let readinessColor = 'text-slate-600 bg-slate-100 border-slate-200';
  if (hasHandovers) {
    readinessLevel = 'Handover Ready';
    readinessColor = 'text-emerald-800 bg-emerald-50 border-emerald-200';
  } else if (hasClaims) {
    readinessLevel = 'Knowledge Extracted';
    readinessColor = 'text-teal-800 bg-teal-50 border-teal-200';
  } else if (hasSources) {
    readinessLevel = 'Sources Ingested';
    readinessColor = 'text-blue-800 bg-blue-50 border-blue-200';
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Project Health & Readiness
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Knowledge reconstruction and handover readiness summary
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">Status:</span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${readinessColor}`}
          >
            {readinessLevel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-1">
        <div>
          <span className="text-xs text-slate-500">Knowledge Coverage</span>
          <p className="text-lg font-bold text-slate-900 mt-0.5">
            {sourceCount > 0 ? `${Math.round(claimCount / sourceCount)} claims/src` : 'No sources'}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Open Questions</span>
          <p className="text-lg font-bold text-slate-900 mt-0.5">{questionCount}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Current Access Epoch</span>
          <p className="text-lg font-bold text-slate-900 mt-0.5">Epoch {accessEpoch}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Active Contributors</span>
          <p className="text-lg font-bold text-slate-900 mt-0.5">{memberCount}</p>
        </div>
      </div>
    </div>
  );
};
