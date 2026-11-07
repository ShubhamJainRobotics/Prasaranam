import React from 'react';

export interface ImportFormatHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImportFormatHelp: React.FC<ImportFormatHelpProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="format-help-title"
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 id="format-help-title" className="text-lg font-semibold text-[var(--color-text)]">
            Supported Import Formats
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 rounded"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-sm text-[var(--color-text)]">
          <section className="space-y-2">
            <h3 className="font-semibold text-base text-[var(--color-primary)]">
              1. Plain Text (.txt) & Markdown (.md)
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Files are parsed as strict UTF-8 text. Paragraphs separated by blank lines are packed
              into chunks up to 1,500 Unicode code points. Exact text and punctuation are preserved
              for citation matching.
            </p>
            <div className="flex gap-3 text-xs pt-1">
              <a
                href="/examples/sample.txt"
                download="sample.txt"
                className="text-[var(--color-primary)] hover:underline flex items-center gap-1 font-medium"
              >
                📥 Download sample.txt
              </a>
              <a
                href="/examples/sample.md"
                download="sample.md"
                className="text-[var(--color-primary)] hover:underline flex items-center gap-1 font-medium"
              >
                📥 Download sample.md
              </a>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-base text-[var(--color-primary)]">
              2. Messages Envelope (<code className="text-xs">relay.messages.v1</code>)
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Used for exported conversation channels, discussions, and chat logs. Each record
              renders with its author, ISO timestamp, and message text. Records are never merged
              into a single chunk.
            </p>
            <pre className="p-3 bg-slate-900 text-slate-100 rounded-md font-mono text-xs overflow-x-auto">
              {`{
  "format": "relay.messages.v1",
  "records": [
    {
      "id": "m-001",
      "text": "We should use Postgres for the ledger.",
      "author": "Asha Rao",
      "timestamp": "2026-03-02T10:15:00Z",
      "url": null
    }
  ]
}`}
            </pre>
            <div className="pt-1">
              <a
                href="/examples/messages.v1.json"
                download="messages.v1.json"
                className="text-[var(--color-primary)] hover:underline flex items-center gap-1 text-xs font-medium"
              >
                📥 Download messages.v1.json
              </a>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-base text-[var(--color-primary)]">
              3. Issues Envelope (<code className="text-xs">relay.issues.v1</code>)
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Used for backlog items, trackers, bug reports, and tasks. Renders issue title, status,
              assignee, updated timestamp, and description.
            </p>
            <pre className="p-3 bg-slate-900 text-slate-100 rounded-md font-mono text-xs overflow-x-auto">
              {`{
  "format": "relay.issues.v1",
  "records": [
    {
      "id": "PAY-12",
      "title": "Sandbox credentials missing",
      "description": "Integration tests cannot run without sandbox credentials.",
      "status": "open",
      "assignee": null,
      "updatedAt": "2026-03-04T09:00:00Z",
      "url": null
    }
  ]
}`}
            </pre>
            <div className="pt-1">
              <a
                href="/examples/issues.v1.json"
                download="issues.v1.json"
                className="text-[var(--color-primary)] hover:underline flex items-center gap-1 text-xs font-medium"
              >
                📥 Download issues.v1.json
              </a>
            </div>
          </section>

          <section className="space-y-2 bg-[var(--color-surface-hover)] p-3 rounded-md border border-[var(--color-border)]">
            <h4 className="font-semibold text-xs text-[var(--color-text)]">
              System Invariants & Security
            </h4>
            <ul className="list-disc list-inside text-xs text-[var(--color-text-muted)] space-y-1">
              <li>Max upload size: 5 MiB per file (max 10 files per request).</li>
              <li>Max JSON records: 10,000 per file; max 100,000 characters per record.</li>
              <li>Max request payload: 2,000,000 extracted Unicode code points.</li>
              <li>
                URLs are preserved purely as text metadata and are <strong>never fetched</strong>.
              </li>
            </ul>
          </section>
        </div>

        <div className="p-4 border-t border-[var(--color-border)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[var(--color-primary)] text-white text-xs font-medium rounded-md hover:bg-[var(--color-primary-hover)] transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
