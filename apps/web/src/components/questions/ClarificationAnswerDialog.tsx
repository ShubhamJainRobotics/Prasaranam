import React, { useState, useRef } from 'react';
import type { ClarificationQuestionSummary } from '@relay/contracts';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  question: ClarificationQuestionSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    questionId: string,
    answer: string,
    visibility: 'project' | 'restricted'
  ) => Promise<void>;
}

export const ClarificationAnswerDialog: React.FC<Props> = ({
  question,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { isOpen, onClose });

  const [answer, setAnswer] = useState('');
  const [visibility, setVisibility] = useState<'project' | 'restricted'>('restricted');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !question) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim()) {
      setError('Please provide an answer');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(question.id, answer.trim(), visibility);
      setAnswer('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby="answer-dialog-title"
        aria-modal="true"
        className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 id="answer-dialog-title" className="text-base font-semibold text-slate-900">
            Answer Clarification Question
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Question
          </span>
          <p className="text-sm font-semibold text-slate-900">{question.question}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="answer-textarea"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Your Answer / Context
            </label>
            <textarea
              id="answer-textarea"
              rows={5}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Provide clear, factual project context to answer this question..."
              className="w-full text-sm p-3 border border-slate-300 rounded focus:ring-1 focus:ring-teal-600"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Your answer will be stored as a reviewer-context source with your identity and
              timestamp, and will be processed by AI extraction.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Source Visibility Policy
            </label>
            <div className="space-y-2 mt-1">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  value="restricted"
                  checked={visibility === 'restricted'}
                  onChange={() => setVisibility('restricted')}
                  className="mt-0.5 text-teal-600 focus:ring-teal-600"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-800">
                    Restricted to author (default)
                  </span>
                  <p className="text-slate-500">
                    Only you can view and use derived claims until explicitly granted to others.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  value="project"
                  checked={visibility === 'project'}
                  onChange={() => setVisibility('project')}
                  className="mt-0.5 text-teal-600 focus:ring-teal-600"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-800">Project visible</span>
                  <p className="text-slate-500">
                    All current and future active project members can view and use derived claims.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit & Enqueue Extraction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
