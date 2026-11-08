import React from 'react';
import type { JobSummary } from '@relay/contracts';

interface Props {
  jobs: JobSummary[];
  onRetry: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onRefresh: () => void;
}

export const JobProgressPanel: React.FC<Props> = ({ jobs, onRetry, onCancel, onRefresh }) => {
  if (jobs.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-2xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider flex items-center gap-2">
          <span>AI Processing Jobs</span>
          <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 text-[10px]">
            {jobs.length}
          </span>
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>Refresh</span>
        </button>
      </div>

      <div className="divide-y divide-slate-100">
        {jobs.map((job) => {
          const isRunning = job.status === 'running';
          const isQueued = job.status === 'queued';
          const isFailed = job.status === 'failed';
          const isSucceeded = job.status === 'succeeded';

          return (
            <div key={job.id} className="py-2.5 flex items-center justify-between text-xs gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 capitalize">
                    {job.kind.replace('_', ' ')}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                      isSucceeded
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : isRunning
                          ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse'
                          : isFailed
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
                <div className="text-slate-500 text-[11px]">
                  Started: {new Date(job.createdAt).toLocaleTimeString()}
                  {job.lastErrorCode && (
                    <span className="text-rose-600 font-mono ml-2">Error: {job.lastErrorCode}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isFailed && (
                  <button
                    type="button"
                    onClick={() => onRetry(job.id)}
                    className="px-2.5 py-1 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    Retry
                  </button>
                )}
                {(isRunning || isQueued) && onCancel && (
                  <button
                    type="button"
                    onClick={() => onCancel(job.id)}
                    className="px-2 py-0.5 text-[11px] font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded focus:outline-none focus:ring-2 focus:ring-rose-500"
                    aria-label={`Cancel ${job.kind.replace('_', ' ')} job`}
                  >
                    Cancel
                  </button>
                )}
                {(isRunning || isQueued) && (
                  <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-teal-600 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(5, job.progress)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
