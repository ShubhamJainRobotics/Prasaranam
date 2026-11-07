import React from 'react';

interface Props {
  reasonCode?: string;
  isRecipient?: boolean;
}

export const StaleHandoverNotice: React.FC<Props> = ({
  reasonCode = 'ACCESS_CHANGED',
  isRecipient = false,
}) => {
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 my-4">
      <div className="flex items-start gap-3">
        <div className="p-1 rounded bg-amber-100 text-amber-800">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            {isRecipient ? 'Regeneration Required' : 'Handover Access Invalidated'}
          </h3>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            {isRecipient ? (
              <>
                This handover is no longer accessible because project source access or membership
                permissions have changed since it was shared. A project reviewer or owner must
                generate and approve a new version before it can be viewed.
              </>
            ) : (
              <>
                The project access epoch has advanced ({reasonCode}). All item contents are locked
                and hidden to prevent stale or revoked data exposure. Please create a new revision
                or re-run handover generation to establish fresh verified claims.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
