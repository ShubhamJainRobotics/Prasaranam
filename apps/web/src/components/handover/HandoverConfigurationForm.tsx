import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateHandoverInputSchema,
  type CreateHandoverInput,
  type HandoverSectionKey,
} from '@relay/contracts';

interface MemberOption {
  userId: string;
  displayName: string;
  role: string;
}

interface Props {
  members: MemberOption[];
  currentUserId: string;
  onSubmit: (data: CreateHandoverInput) => Promise<void>;
  loading?: boolean;
}

const ALL_SECTIONS: Array<{ key: HandoverSectionKey; label: string }> = [
  { key: 'snapshot', label: 'Project Snapshot' },
  { key: 'decisions', label: 'Decisions & Rationale' },
  { key: 'work_in_progress', label: 'Work in Progress' },
  { key: 'owners_contacts', label: 'Owners & Contacts' },
  { key: 'risks_dependencies', label: 'Risks & Dependencies' },
  { key: 'open_questions', label: 'Open Questions' },
  { key: 'next_actions', label: 'Suggested Next Actions' },
];

export const HandoverConfigurationForm: React.FC<Props> = ({
  members,
  currentUserId,
  onSubmit,
  loading = false,
}) => {
  // Exclude current reviewer from default recipient candidate if alternatives exist
  const candidateRecipients = members.filter((m) => m.userId !== currentUserId);
  const defaultRecipientId = candidateRecipients[0]?.userId || members[0]?.userId || '';

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateHandoverInput>({
    resolver: zodResolver(CreateHandoverInputSchema),
    defaultValues: {
      title: 'Project Knowledge Handover',
      recipientId: defaultRecipientId,
      departingUserId: currentUserId,
      includedSections: [
        'snapshot',
        'decisions',
        'work_in_progress',
        'owners_contacts',
        'risks_dependencies',
        'open_questions',
        'next_actions',
      ],
      detailLevel: 'standard',
      includeCompletedWork: true,
      includeProposedNextActions: true,
      tone: 'professional',
    },
  });

  const selectedSections = watch('includedSections') || [];

  const handleSectionToggle = (secKey: HandoverSectionKey) => {
    if (selectedSections.includes(secKey)) {
      if (selectedSections.length > 1) {
        setValue(
          'includedSections',
          selectedSections.filter((k) => k !== secKey),
          { shouldValidate: true }
        );
      }
    } else {
      setValue('includedSections', [...selectedSections, secKey], { shouldValidate: true });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      {/* Title */}
      <div>
        <label htmlFor="title" className="block text-sm font-semibold text-slate-900 mb-1">
          Handover Title *
        </label>
        <input
          id="title"
          type="text"
          {...register('title')}
          placeholder="e.g. Infrastructure Architecture Handover"
          className="w-full text-sm rounded-lg border border-slate-300 p-2.5 focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          disabled={loading}
        />
        {errors.title && <p className="text-xs text-rose-600 mt-1">{errors.title.message}</p>}
      </div>

      {/* Recipient & Departing User Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="recipientId" className="block text-sm font-semibold text-slate-900 mb-1">
            Recipient (Incoming Member) *
          </label>
          <select
            id="recipientId"
            {...register('recipientId')}
            className="w-full text-sm rounded-lg border border-slate-300 p-2.5 bg-white focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            disabled={loading}
          >
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName} ({m.role})
              </option>
            ))}
          </select>
          {errors.recipientId && (
            <p className="text-xs text-rose-600 mt-1">{errors.recipientId.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="departingUserId"
            className="block text-sm font-semibold text-slate-900 mb-1"
          >
            Departing Member (Optional)
          </label>
          <select
            id="departingUserId"
            {...register('departingUserId')}
            className="w-full text-sm rounded-lg border border-slate-300 p-2.5 bg-white focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            disabled={loading}
          >
            <option value="">None / Not specified</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName} ({m.role})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Included Sections */}
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">
          Included Sections (at least one required)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-4">
          {ALL_SECTIONS.map((sec) => {
            const isChecked = selectedSections.includes(sec.key);
            return (
              <label
                key={sec.key}
                className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleSectionToggle(sec.key)}
                  disabled={loading}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>{sec.label}</span>
              </label>
            );
          })}
        </div>
        {errors.includedSections && (
          <p className="text-xs text-rose-600 mt-1">{errors.includedSections.message}</p>
        )}
      </div>

      {/* Detail Level & Tone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1">Detail Level</label>
          <select
            {...register('detailLevel')}
            className="w-full text-sm rounded-lg border border-slate-300 p-2.5 bg-white focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            disabled={loading}
          >
            <option value="concise">Concise (max 8 items/section)</option>
            <option value="standard">Standard (max 15 items/section)</option>
            <option value="detailed">Detailed (max 30 items/section)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1">Tone</label>
          <select
            {...register('tone')}
            className="w-full text-sm rounded-lg border border-slate-300 p-2.5 bg-white focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            disabled={loading}
          >
            <option value="professional">Professional</option>
            <option value="plain_language">Plain Language</option>
          </select>
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
        <label className="flex items-center gap-2.5 text-xs font-medium text-slate-800 cursor-pointer select-none">
          <input
            type="checkbox"
            {...register('includeCompletedWork')}
            disabled={loading}
            className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          <span>Include completed and historical project work in background context</span>
        </label>

        <label className="flex items-center gap-2.5 text-xs font-medium text-slate-800 cursor-pointer select-none">
          <input
            type="checkbox"
            {...register('includeProposedNextActions')}
            disabled={loading}
            className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          <span>Include proposed next actions and proactive recommendations</span>
        </label>
      </div>

      {/* Priority Focus */}
      <div>
        <label htmlFor="priorityFocus" className="block text-sm font-semibold text-slate-900 mb-1">
          Priority Focus (Optional)
        </label>
        <textarea
          id="priorityFocus"
          rows={3}
          {...register('priorityFocus')}
          placeholder="e.g. Focus particularly on database migrations, vault credentials, and payment reconciliation..."
          className="w-full text-sm rounded-lg border border-slate-300 p-2.5 focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          disabled={loading}
        />
        <p className="text-[11px] text-slate-500 mt-1">
          Preferences guide emphasis only and never widen or override evidence security boundaries.
        </p>
      </div>

      {/* Submit Button */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-xl shadow-xs transition-colors disabled:opacity-50"
        >
          {loading ? 'Generating Handover...' : 'Generate Handover Draft'}
        </button>
      </div>
    </form>
  );
};
