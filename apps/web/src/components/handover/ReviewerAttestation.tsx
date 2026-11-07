import React from 'react';

interface Props {
  recipientName: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const ReviewerAttestation: React.FC<Props> = ({
  recipientName,
  checked,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <input
          id="reviewer-attestation-checkbox"
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-amber-300 text-teal-700 focus:ring-teal-600 focus:ring-offset-0 disabled:opacity-50"
        />
        <label
          htmlFor="reviewer-attestation-checkbox"
          className="text-sm font-medium text-slate-800 leading-snug cursor-pointer select-none"
        >
          <span className="font-semibold text-slate-900 block mb-1">
            Mandatory Reviewer Confirmation
          </span>
          I confirm that I have reviewed this handover specifically for recipient{' '}
          <strong className="text-slate-900 font-semibold">{recipientName}</strong> and verified its
          contents are safe and appropriate for their access.
        </label>
      </div>
    </div>
  );
};
