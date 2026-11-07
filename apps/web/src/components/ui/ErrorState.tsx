import React from 'react';

export const ErrorState: React.FC<{
  title?: string;
  message: string;
  onRetry?: () => void;
}> = ({ title = 'Something went wrong', message, onRetry }) => {
  return (
    <div className="p-6 rounded-lg border border-red-200 bg-red-50 text-left my-4" role="alert">
      <h3 className="text-base font-semibold text-red-900 mb-1">{title}</h3>
      <p className="text-sm text-red-700 mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-red-800 text-white hover:bg-red-900 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Try Again
        </button>
      )}
    </div>
  );
};
