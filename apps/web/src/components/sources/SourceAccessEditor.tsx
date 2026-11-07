import React, { useState, useEffect } from 'react';

export interface ProjectMemberOption {
  userId: string;
  displayName: string;
  role: string;
}

export interface SourceAccessEditorProps {
  isOpen: boolean;
  onClose: () => void;
  source: {
    id: string;
    title: string;
    visibility: 'project' | 'restricted';
    grants?: string[];
  } | null;
  projectMembers: ProjectMemberOption[];
  onSave: (visibility: 'project' | 'restricted', grantUserIds: string[]) => Promise<void>;
}

export const SourceAccessEditor: React.FC<SourceAccessEditorProps> = ({
  isOpen,
  onClose,
  source,
  projectMembers,
  onSave,
}) => {
  const [visibility, setVisibility] = useState<'project' | 'restricted'>('project');
  const [selectedGrants, setSelectedGrants] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source) {
      setVisibility(source.visibility);
      setSelectedGrants(source.grants || []);
      setError(null);
    }
  }, [source]);

  if (!isOpen || !source) return null;

  const toggleGrant = (userId: string) => {
    setSelectedGrants((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(visibility, visibility === 'restricted' ? selectedGrants : []);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update source access');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-editor-title"
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl max-w-md w-full overflow-hidden">
        <form onSubmit={handleSave}>
          <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2
              id="access-editor-title"
              className="text-base font-semibold text-[var(--color-text)]"
            >
              Edit Source Access
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 rounded"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-4 text-sm">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Source:</p>
              <p className="font-medium text-[var(--color-text)] truncate">{source.title}</p>
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-medium text-[var(--color-text)]">
                Access Policy
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility('project')}
                  className={`p-3 text-left border rounded-md transition-all ${
                    visibility === 'project'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] ring-1 ring-[var(--color-primary)]'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="font-semibold text-xs block text-[var(--color-text)]">
                    Project-wide
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    All current and future project members can view.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setVisibility('restricted')}
                  className={`p-3 text-left border rounded-md transition-all ${
                    visibility === 'restricted'
                      ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="font-semibold text-xs block text-amber-900">Restricted</span>
                  <span className="text-[11px] text-amber-700">
                    Visible only to explicitly granted project members.
                  </span>
                </button>
              </div>
            </div>

            {visibility === 'restricted' && (
              <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--color-text)]">
                    Granted Project Members
                  </label>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {selectedGrants.length} granted
                  </span>
                </div>

                <div className="max-h-48 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                  {projectMembers.length === 0 ? (
                    <div className="p-3 text-center text-xs text-[var(--color-text-muted)]">
                      No members available in this project
                    </div>
                  ) : (
                    projectMembers.map((member) => {
                      const isGranted = selectedGrants.includes(member.userId);
                      return (
                        <label
                          key={member.userId}
                          className="flex items-center justify-between p-2.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isGranted}
                              onChange={() => toggleGrant(member.userId)}
                              className="rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                            />
                            <span className="font-medium text-[var(--color-text)]">
                              {member.displayName}
                            </span>
                            <span className="text-[10px] uppercase font-mono px-1 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]">
                              {member.role}
                            </span>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Updating access policies automatically invalidates stale handovers and increments
                  the project access epoch.
                </p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-end gap-2 bg-[var(--color-surface-hover)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 border border-[var(--color-border)] text-xs font-medium rounded-md hover:bg-[var(--color-surface)] text-[var(--color-text)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-3 py-1.5 bg-[var(--color-primary)] text-white text-xs font-medium rounded-md hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Access'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
