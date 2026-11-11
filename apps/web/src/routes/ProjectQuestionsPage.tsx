import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Breadcrumbs } from '../components/ui/Breadcrumbs.js';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorState } from '../components/ui/ErrorState.js';
import { ClarificationQuestionCard } from '../components/questions/ClarificationQuestionCard.js';
import { ClarificationAnswerDialog } from '../components/questions/ClarificationAnswerDialog.js';
import { apiFetch, apiFetchPaginated } from '../lib/api.js';
import { useToast } from '../context/ToastContext.js';
import type { ClarificationQuestionSummary, ClarificationStatus } from '@relay/contracts';

export const ProjectQuestionsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [statusFilter, setStatusFilter] = useState<ClarificationStatus | 'all'>('open');
  const [questions, setQuestions] = useState<ClarificationQuestionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [answeringQuestion, setAnsweringQuestion] = useState<ClarificationQuestionSummary | null>(
    null
  );
  const [generating, setGenerating] = useState(false);

  const fetchQuestions = useCallback(
    async (cursor?: string) => {
      if (!projectId) return;
      try {
        const queryParams = new URLSearchParams();
        if (cursor) queryParams.set('cursor', cursor);
        if (statusFilter !== 'all') queryParams.set('status', statusFilter);

        const url = `/projects/${projectId}/questions?${queryParams.toString()}`;
        const res = await apiFetchPaginated<ClarificationQuestionSummary[]>(url);

        if (cursor) {
          setQuestions((prev) => [...prev, ...res.data]);
        } else {
          setQuestions(res.data);
        }

        setNextCursor(res.page?.nextCursor || null);
        setHasMore(Boolean(res.page?.hasMore));
      } catch (err: any) {
        setError(err.message || 'Failed to load questions');
      }
    },
    [projectId, statusFilter]
  );

  useEffect(() => {
    setLoading(true);
    fetchQuestions().finally(() => {
      setLoading(false);
    });
  }, [fetchQuestions]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchQuestions(nextCursor);
    setLoadingMore(false);
  };

  const handleGenerateQuestions = async () => {
    if (!projectId) return;
    try {
      setGenerating(true);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/projects/${projectId}/questions/generate`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({}),
      });

      showToast('Question generation job enqueued', 'success');
      fetchQuestions();
    } catch (err: any) {
      showToast(err.message || 'Failed to generate questions', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleAnswerSubmit = async (
    questionId: string,
    answer: string,
    visibility: 'project' | 'restricted'
  ) => {
    await apiFetch(`/questions/${questionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer, visibility }),
    });

    showToast('Answer submitted; extraction enqueued for reviewer context', 'success');

    fetchQuestions();
  };

  const handleDismiss = async (questionId: string) => {
    try {
      await apiFetch(`/questions/${questionId}/dismiss`, {
        method: 'POST',
      });

      showToast('Question dismissed', 'success');

      fetchQuestions();
    } catch (err: any) {
      showToast(err.message || 'Failed to dismiss question', 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton lines={4} />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => fetchQuestions()} />;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/app' },
          { label: 'Dashboard', href: `/app/projects/${projectId}` },
          { label: 'Knowledge Base', href: `/app/projects/${projectId}/knowledge` },
          { label: 'Clarifications' },
        ]}
      />

      <PageHeader
        title="Clarification Questions"
        description="Targeted questions highlighting ambiguities, unassigned ownership, or conflicting statements."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/app/projects/${projectId}/knowledge`)}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors"
            >
              Back to Knowledge Base
            </button>
            <button
              type="button"
              onClick={handleGenerateQuestions}
              disabled={generating}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded shadow-xs transition-colors disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{generating ? 'Generating...' : 'Generate Questions'}</span>
            </button>
          </div>
        }
      />

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-200 gap-4 text-xs font-medium">
        <button
          type="button"
          onClick={() => setStatusFilter('open')}
          className={`pb-2.5 -mb-px ${
            statusFilter === 'open'
              ? 'border-b-2 border-teal-700 text-teal-900 font-semibold'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Open Questions
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('answered')}
          className={`pb-2.5 -mb-px ${
            statusFilter === 'answered'
              ? 'border-b-2 border-teal-700 text-teal-900 font-semibold'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Answered
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('dismissed')}
          className={`pb-2.5 -mb-px ${
            statusFilter === 'dismissed'
              ? 'border-b-2 border-teal-700 text-teal-900 font-semibold'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Dismissed
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`pb-2.5 -mb-px ${
            statusFilter === 'all'
              ? 'border-b-2 border-teal-700 text-teal-900 font-semibold'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          All
        </button>
      </div>

      {/* Question Cards List */}
      {questions.length === 0 ? (
        <EmptyState
          title={`No ${statusFilter === 'all' ? '' : statusFilter} questions found`}
          description="Click 'Generate Questions' to let Prasaranam identify knowledge gaps and ambiguities in the project."
          action={{
            label: 'Generate Questions',
            onClick: handleGenerateQuestions,
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {questions.map((question) => (
              <ClarificationQuestionCard
                key={question.id}
                question={question}
                onAnswer={(q) => setAnsweringQuestion(q)}
                onDismiss={handleDismiss}
              />
            ))}
          </div>

          {hasMore && (
            <div className="text-center pt-4">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 shadow-xs disabled:opacity-50"
              >
                {loadingMore ? 'Loading more...' : 'Load More Questions'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Answer Modal Dialog */}
      <ClarificationAnswerDialog
        question={answeringQuestion}
        isOpen={Boolean(answeringQuestion)}
        onClose={() => setAnsweringQuestion(null)}
        onSubmit={handleAnswerSubmit}
      />
    </div>
  );
};
