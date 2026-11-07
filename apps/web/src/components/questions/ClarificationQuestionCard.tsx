import React from 'react';
import type { ClarificationQuestionSummary } from '@relay/contracts';

interface Props {
  question: ClarificationQuestionSummary;
  onAnswer: (question: ClarificationQuestionSummary) => void;
  onDismiss: (questionId: string) => void;
}

export const ClarificationQuestionCard: React.FC<Props> = ({ question, onAnswer, onDismiss }) => {
  const isOpen = question.status === 'open';
  const isAnswered = question.status === 'answered';

  const priorityClasses =
    {
      high: 'bg-rose-50 text-rose-800 border-rose-200',
      medium: 'bg-amber-50 text-amber-800 border-amber-200',
      low: 'bg-slate-100 text-slate-700 border-slate-200',
    }[question.priority] || 'bg-slate-100 text-slate-700';

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider border ${priorityClasses}`}
          >
            {question.priority} Priority
          </span>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${
              isOpen
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : isAnswered
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-100 text-slate-500'
            }`}
          >
            {question.status}
          </span>
        </div>

        <span className="text-xs text-slate-400">
          Created for:{' '}
          <span className="font-medium text-slate-600">
            {question.createdForDisplayName || 'Team Member'}
          </span>
        </span>
      </div>

      <div className="space-y-1">
        <h4 className="text-base font-semibold text-slate-900 leading-snug">{question.question}</h4>
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-600">Rationale: </span>
          {question.reason}
        </p>
      </div>

      {/* Related claims */}
      {question.relatedClaims && question.relatedClaims.length > 0 && (
        <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1.5 text-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Related Claims ({question.relatedClaims.length})
          </span>
          <ul className="space-y-1 text-slate-700">
            {question.relatedClaims.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 truncate">
                <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 text-[10px] font-mono">
                  {c.kind}
                </span>
                <span className="truncate">{c.statement}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Answer summary if already answered */}
      {isAnswered && (
        <div className="p-3 bg-emerald-50/60 rounded border border-emerald-200 text-xs text-emerald-900 space-y-1">
          <div className="font-semibold flex items-center gap-1 text-emerald-800">
            <svg
              className="w-4 h-4 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span>Answered by {question.answeredByDisplayName || 'Reviewer'}</span>
            {question.answeredAt && (
              <span className="text-emerald-700 font-normal ml-1">
                on {new Date(question.answeredAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {isOpen && (
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => onDismiss(question.id)}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded hover:bg-slate-50"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => onAnswer(question)}
            className="px-4 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded shadow-xs"
          >
            Answer Question
          </button>
        </div>
      )}
    </div>
  );
};
