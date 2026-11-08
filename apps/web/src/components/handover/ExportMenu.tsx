import React, { useState, useRef, useEffect } from 'react';
import { api, RelayApiError } from '../../lib/api.js';

interface Props {
  handoverId: string;
  title: string;
  version: number;
  status: string;
  isStale?: boolean;
}

export const ExportMenu: React.FC<Props> = ({
  handoverId,
  title,
  version,
  status,
  isStale = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isEligible = (status === 'approved' || status === 'shared') && !isStale;

  const handleDownload = async (format: 'md' | 'pdf') => {
    setIsOpen(false);
    setIsExporting(true);
    setExportError(null);

    const slug =
      (title || 'handover')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 50) || 'handover';
    const fallbackFilename = `relay-handover-${slug}-v${version}.${format}`;

    try {
      await api.download(`/handovers/${handoverId}/export?format=${format}`, fallbackFilename);
    } catch (err) {
      const apiErr = err as RelayApiError;
      if (apiErr.code === 'REGENERATION_REQUIRED' || apiErr.status === 409) {
        setExportError(
          'Handover is stale or cites inaccessible evidence and cannot be exported until regenerated.'
        );
      } else {
        setExportError(apiErr.message || 'Export failed. Please try again.');
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        data-testid="export-handover-btn"
        disabled={!isEligible || isExporting}
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs transition-colors"
        title={
          !isEligible
            ? 'Only approved or shared handovers without access changes can be exported.'
            : 'Export handover'
        }
      >
        <svg
          className="w-4 h-4 text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span>{isExporting ? 'Exporting...' : 'Export'}</span>
        <svg
          className="w-3 h-3 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 rounded-md bg-white shadow-lg border border-slate-200 z-50 py-1">
          <button
            type="button"
            data-testid="export-md-btn"
            onClick={() => handleDownload('md')}
            className="w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-100 flex items-center space-x-2"
          >
            <span>📝</span>
            <span>Export Markdown (.md)</span>
          </button>
          <button
            type="button"
            data-testid="export-pdf-btn"
            onClick={() => handleDownload('pdf')}
            className="w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-100 flex items-center space-x-2 border-t border-slate-100"
          >
            <span>📄</span>
            <span>Export PDF (.pdf)</span>
          </button>
        </div>
      )}

      {/* Export Error Alert Modal / Toast */}
      {exportError && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg shadow-lg flex items-start space-x-2 text-xs">
          <svg
            className="w-4 h-4 text-rose-500 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1">
            <p className="font-semibold">Export Failed</p>
            <p className="mt-0.5">{exportError}</p>
          </div>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="text-rose-400 hover:text-rose-600 font-bold ml-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
