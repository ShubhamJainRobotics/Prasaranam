import React from 'react';
import type { ClaimEvidenceDetail } from '@relay/contracts';

interface Props {
  evidence: ClaimEvidenceDetail;
  onClick?: () => void;
}

export const EvidenceCitation: React.FC<Props> = ({ evidence, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`text-xs p-2.5 rounded bg-slate-50 border border-slate-200 space-y-1 ${
        onClick ? 'cursor-pointer hover:bg-slate-100 transition-colors' : ''
      }`}
    >
      <div className="flex items-center justify-between text-slate-500">
        <span className="font-semibold text-slate-700 truncate" title={evidence.sourceTitle}>
          {evidence.sourceTitle}
        </span>
        <span className="font-mono text-[10px] text-slate-500">
          [{evidence.quoteStart}, {evidence.quoteEnd})
        </span>
      </div>
      <p className="text-slate-800 font-mono text-[11px] leading-relaxed italic">
        &ldquo;{evidence.quote}&rdquo;
      </p>
    </div>
  );
};
