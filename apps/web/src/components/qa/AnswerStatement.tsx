import React from 'react';
import type { MessageCitation } from '@relay/contracts';

export interface AnswerStatementData {
  status: 'answered' | 'insufficient_evidence' | 'conflicting_evidence';
  statements: Array<{
    text: string;
    claimIds: string[];
    citations?: MessageCitation[];
  }>;
  limitations: string[];
  suggestedClarification?: string | null;
}

interface Props {
  answer: AnswerStatementData;
  onSelectClarification?: (question: string) => void;
}

export const AnswerStatement: React.FC<Props> = ({ answer, onSelectClarification }) => {
  const [selectedCitation, setSelectedCitation] = React.useState<MessageCitation | null>(null);

  const getStatusBadge = () => {
    switch (answer.status) {
      case 'answered':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
            <span className="w-1.5 h-1.5 mr-1.5 bg-emerald-500 rounded-full"></span>
            Answered with Evidence
          </span>
        );
      case 'conflicting_evidence':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            <span className="w-1.5 h-1.5 mr-1.5 bg-amber-500 rounded-full"></span>
            Conflicting Evidence Found
          </span>
        );
      case 'insufficient_evidence':
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
            <span className="w-1.5 h-1.5 mr-1.5 bg-slate-400 rounded-full"></span>
            Insufficient Evidence
          </span>
        );
    }
  };

  return (
    <div className="space-y-4" data-testid="answer-statement-container">
      {/* Status Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>{getStatusBadge()}</div>
      </div>

      {/* Statements List */}
      {answer.statements.length > 0 ? (
        <div className="space-y-3">
          {answer.statements.map((stmt, idx) => (
            <div
              key={idx}
              className="p-3 bg-slate-50/80 rounded-lg border border-slate-200/80 space-y-2"
              data-testid={`statement-${idx}`}
            >
              <p className="text-sm text-slate-900 leading-relaxed font-normal">{stmt.text}</p>

              {/* Citations */}
              {stmt.citations && stmt.citations.length > 0 && (
                <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Evidence ({stmt.citations.length})
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {stmt.citations.map((cit, cIdx) => (
                      <div
                        key={cIdx}
                        className="text-xs p-2 rounded bg-white border border-slate-200/90 text-slate-700 shadow-2xs hover:border-slate-300 transition-colors"
                        onClick={() => setSelectedCitation(cit)}
                      >
                        <div className="flex items-center justify-between font-medium text-slate-800 mb-1">
                          <span className="truncate max-w-[280px]" title={cit.sourceTitle}>
                            📄 {cit.sourceTitle}
                          </span>
                          {cit.evidenceState && (
                            <span
                              className={`text-[10px] uppercase px-1.5 py-0.2 rounded font-semibold ${
                                cit.evidenceState === 'supported'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {cit.evidenceState}
                            </span>
                          )}
                        </div>
                        {cit.quote && (
                          <p className="text-[11px] font-mono text-slate-600 bg-slate-50 p-1.5 rounded italic border border-slate-100">
                            &ldquo;{cit.quote}&rdquo;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-sm text-slate-600">
          No factual statements could be verified for this question under your current project
          access.
        </div>
      )}

      {/* Limitations / Scope Caveats */}
      {answer.limitations && answer.limitations.length > 0 && (
        <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-md">
          <div className="flex items-center text-xs font-semibold text-amber-800 mb-1">
            <svg
              className="w-4 h-4 mr-1 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Limitations & Notes
          </div>
          <ul className="list-disc list-inside text-xs text-amber-900 space-y-0.5">
            {answer.limitations.map((lim, lIdx) => (
              <li key={lIdx} className="leading-relaxed">
                {lim}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggested Follow-up Question */}
      {answer.suggestedClarification && (
        <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-md flex items-center justify-between">
          <div className="text-xs text-indigo-900">
            <span className="font-semibold">Suggested follow-up:</span>{' '}
            <span>{answer.suggestedClarification}</span>
          </div>
          {onSelectClarification && (
            <button
              type="button"
              onClick={() => onSelectClarification(answer.suggestedClarification!)}
              className="ml-3 shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-white px-2.5 py-1 rounded border border-indigo-200 hover:border-indigo-300 shadow-2xs"
            >
              Ask this
            </button>
          )}
        </div>
      )}

      {/* Citation Detail Modal */}
      {selectedCitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-sm font-semibold text-slate-900">Evidence Citation</h3>
              <button
                type="button"
                onClick={() => setSelectedCitation(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <span className="font-semibold text-slate-500">Source:</span>{' '}
                <span className="text-slate-800 font-medium">{selectedCitation.sourceTitle}</span>
              </div>
              {selectedCitation.statement && (
                <div>
                  <span className="font-semibold text-slate-500">Claim:</span>{' '}
                  <span className="text-slate-800">{selectedCitation.statement}</span>
                </div>
              )}
              {selectedCitation.quote && (
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">
                    Exact Quoted Span:
                  </span>
                  <p className="bg-slate-50 p-2.5 rounded font-mono text-[11px] text-slate-700 border italic leading-relaxed">
                    &ldquo;{selectedCitation.quote}&rdquo;
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedCitation(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
