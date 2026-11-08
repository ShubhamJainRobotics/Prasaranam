import React from 'react';

interface Props {
  message?: string;
  retryAfterSeconds?: number;
  onDismiss?: () => void;
}

export const QuotaNotice: React.FC<Props> = ({
  message = 'AI usage quota or rate limit exceeded. Please wait before triggering more generation.',
  retryAfterSeconds,
  onDismiss,
}) => {
  return (
    <div
      role="alert"
      className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-2xs mb-4 flex items-start justify-between"
    >
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="text-sm text-amber-800">
          <p className="font-semibold">AI Quota Limit Reached</p>
          <p className="mt-0.5 text-xs text-amber-700">{message}</p>
          {retryAfterSeconds !== undefined && retryAfterSeconds > 0 && (
            <p className="mt-1 text-xs text-amber-900 font-medium">
              Retry available in approximately {retryAfterSeconds} seconds.
            </p>
          )}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-amber-500 hover:text-amber-700 p-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
          aria-label="Dismiss quota notice"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
