import React from 'react';

interface Props {
  recipientName: string;
  onExit: () => void;
  children: React.ReactNode;
}

export const RecipientPreview: React.FC<Props> = ({ recipientName, onExit, children }) => {
  return (
    <div className="relative">
      <div className="bg-purple-600 text-white px-6 py-2.5 flex items-center justify-between text-xs font-medium shadow-xs">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <span>
            Previewing recipient view for{' '}
            <strong className="font-bold underline">{recipientName}</strong> (only approved items
            visible)
          </span>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-semibold text-white transition-colors"
        >
          Exit Preview
        </button>
      </div>

      <div className="p-4 bg-purple-50/20">{children}</div>
    </div>
  );
};
