import React, { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { FileDropzone } from './FileDropzone.js';
import { ImportFormatHelp } from './ImportFormatHelp.js';
import type { ProjectMemberOption } from './SourceAccessEditor.js';

export interface ImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentUserId: string;
  projectMembers: ProjectMemberOption[];
  onImportCompleted: () => void;
}

export const ImportWizard: React.FC<ImportWizardProps> = ({
  isOpen,
  onClose,
  projectId,
  currentUserId,
  projectMembers,
  onImportCompleted,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteKind, setPasteKind] = useState<'text' | 'markdown'>('text');
  const [pasteContent, setPasteContent] = useState('');
  const [singleFileTitle, setSingleFileTitle] = useState('');
  const [visibility, setVisibility] = useState<'project' | 'restricted'>('project');
  const [selectedGrants, setSelectedGrants] = useState<string[]>([currentUserId]);
  const [authorLabel, setAuthorLabel] = useState('');
  const [eventAt, setEventAt] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleGrant = (uid: string) => {
    setSelectedGrants((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (activeTab === 'upload') {
        if (files.length === 0) {
          throw new Error('Please select at least one file to upload.');
        }

        const formData = new FormData();
        for (const file of files) {
          formData.append('files', file);
        }

        if (files.length === 1 && singleFileTitle.trim()) {
          formData.append('title', singleFileTitle.trim());
        }

        formData.append('visibility', visibility);
        if (visibility === 'restricted') {
          formData.append('grantUserIds', JSON.stringify(selectedGrants));
        }
        if (authorLabel.trim()) formData.append('authorLabel', authorLabel.trim());
        if (eventAt.trim()) formData.append('eventAt', new Date(eventAt).toISOString());
        if (originalUrl.trim()) formData.append('originalUrl', originalUrl.trim());

        await apiFetch(`/projects/${projectId}/sources/import`, {
          method: 'POST',
          body: formData,
        });
      } else {
        // Paste Tab
        if (!pasteTitle.trim()) {
          throw new Error('Source title is required for pasted text.');
        }
        if (!pasteContent.trim()) {
          throw new Error('Source content cannot be empty.');
        }

        const payload: Record<string, unknown> = {
          title: pasteTitle.trim(),
          kind: pasteKind,
          content: pasteContent,
          visibility,
          grantUserIds: visibility === 'restricted' ? selectedGrants : [],
        };

        if (authorLabel.trim()) payload.authorLabel = authorLabel.trim();
        if (eventAt.trim()) payload.eventAt = new Date(eventAt).toISOString();
        if (originalUrl.trim()) payload.originalUrl = originalUrl.trim();

        await apiFetch(`/projects/${projectId}/sources/import`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      onImportCompleted();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during import.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-wizard-title"
      >
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2
                id="import-wizard-title"
                className="text-base font-semibold text-[var(--color-text)]"
              >
                Import Project Sources
              </h2>
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-0.5 ml-2"
              >
                Format Help ℹ️
              </button>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 rounded"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md">
                {errorMessage}
              </div>
            )}

            {/* Mode Tabs */}
            <div className="flex border-b border-[var(--color-border)] gap-4 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className={`pb-2 border-b-2 transition-colors ${
                  activeTab === 'upload'
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                📁 Upload Files
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('paste')}
                className={`pb-2 border-b-2 transition-colors ${
                  activeTab === 'paste'
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                📝 Paste Text
              </button>
            </div>

            {/* Tab 1: Upload Files */}
            {activeTab === 'upload' && (
              <div className="space-y-4">
                <FileDropzone files={files} onFilesChanged={setFiles} />

                {files.length === 1 && (
                  <div>
                    <label
                      htmlFor="single-file-title"
                      className="block text-xs font-medium text-[var(--color-text)] mb-1"
                    >
                      Source Title (optional, defaults to filename)
                    </label>
                    <input
                      id="single-file-title"
                      type="text"
                      value={singleFileTitle}
                      onChange={(e) => setSingleFileTitle(e.target.value)}
                      placeholder={files[0]?.name}
                      maxLength={200}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-xs bg-[var(--color-surface)] text-[var(--color-text)]"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Paste Text */}
            {activeTab === 'paste' && (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="paste-title"
                    className="block text-xs font-medium text-[var(--color-text)] mb-1"
                  >
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="paste-title"
                    type="text"
                    required
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder="e.g. Architecture decision note"
                    maxLength={200}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-xs bg-[var(--color-surface)] text-[var(--color-text)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-text)] mb-1">
                    Format
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text)] cursor-pointer">
                      <input
                        type="radio"
                        name="pasteKind"
                        value="text"
                        checked={pasteKind === 'text'}
                        onChange={() => setPasteKind('text')}
                      />
                      Plain Text
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text)] cursor-pointer">
                      <input
                        type="radio"
                        name="pasteKind"
                        value="markdown"
                        checked={pasteKind === 'markdown'}
                        onChange={() => setPasteKind('markdown')}
                      />
                      Markdown
                    </label>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label
                      htmlFor="paste-content"
                      className="block text-xs font-medium text-[var(--color-text)]"
                    >
                      Content <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                      {pasteContent.length.toLocaleString()} characters
                    </span>
                  </div>
                  <textarea
                    id="paste-content"
                    rows={8}
                    required
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    placeholder="Paste project discussion, meeting notes, or architecture decisions..."
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-xs font-mono bg-[var(--color-surface)] text-[var(--color-text)]"
                  />
                </div>
              </div>
            )}

            {/* Common Access Control */}
            <div className="pt-3 border-t border-[var(--color-border)] space-y-3">
              <label className="block text-xs font-medium text-[var(--color-text)]">
                Access Policy
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility('project')}
                  className={`p-2.5 text-left border rounded-md transition-all ${
                    visibility === 'project'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] ring-1 ring-[var(--color-primary)]'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="font-semibold text-xs block text-[var(--color-text)]">
                    Project-wide
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    All members of this project can view.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setVisibility('restricted')}
                  className={`p-2.5 text-left border rounded-md transition-all ${
                    visibility === 'restricted'
                      ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="font-semibold text-xs block text-amber-900">Restricted</span>
                  <span className="text-[11px] text-amber-700">
                    Explicitly granted project members only.
                  </span>
                </button>
              </div>

              {visibility === 'restricted' && (
                <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-medium text-[var(--color-text)]">Granted Members</span>
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      Defaults to importing user ({selectedGrants.length} granted)
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                    {projectMembers.map((m) => (
                      <label
                        key={m.userId}
                        className="flex items-center gap-2 p-2 hover:bg-[var(--color-surface-hover)] cursor-pointer text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={selectedGrants.includes(m.userId)}
                          onChange={() => toggleGrant(m.userId)}
                          className="rounded border-[var(--color-border)] text-[var(--color-primary)]"
                        />
                        <span className="text-[var(--color-text)]">{m.displayName}</span>
                        {m.userId === currentUserId && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1 rounded">
                            You
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Optional Metadata */}
            <div className="pt-3 border-t border-[var(--color-border)] space-y-3">
              <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block">
                Optional Provenance Metadata
              </span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[var(--color-text)] mb-1">
                    Author / Speaker
                  </label>
                  <input
                    type="text"
                    value={authorLabel}
                    onChange={(e) => setAuthorLabel(e.target.value)}
                    placeholder="e.g. Lead Architect"
                    maxLength={200}
                    className="w-full px-2.5 py-1.5 border border-[var(--color-border)] rounded text-xs bg-[var(--color-surface)] text-[var(--color-text)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-text)] mb-1">
                    Original Event Date
                  </label>
                  <input
                    type="date"
                    value={eventAt}
                    onChange={(e) => setEventAt(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[var(--color-border)] rounded text-xs bg-[var(--color-surface)] text-[var(--color-text)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-text)] mb-1">
                    Reference URL
                  </label>
                  <input
                    type="url"
                    value={originalUrl}
                    onChange={(e) => setOriginalUrl(e.target.value)}
                    placeholder="https://..."
                    maxLength={2048}
                    className="w-full px-2.5 py-1.5 border border-[var(--color-border)] rounded text-xs bg-[var(--color-surface)] text-[var(--color-text)]"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--color-border)] flex justify-end gap-2">
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
                disabled={isSubmitting || (activeTab === 'upload' && files.length === 0)}
                className="px-4 py-2 bg-[var(--color-primary)] text-white text-xs font-medium rounded-md hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Importing...' : 'Start Import'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ImportFormatHelp isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </>
  );
};
