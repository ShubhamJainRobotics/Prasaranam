import React, { useRef, useState } from 'react';

export interface FileDropzoneProps {
  files: File[];
  onFilesChanged: (files: File[]) => void;
  maxFiles?: number;
  maxBytes?: number;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  files,
  onFilesChanged,
  maxFiles = 10,
  maxBytes = 5 * 1024 * 1024,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = (newFiles: FileList | File[]) => {
    setErrorMessage(null);
    const validExtensions = ['.txt', '.md', '.json'];
    const candidates = Array.from(newFiles);

    if (files.length + candidates.length > maxFiles) {
      setErrorMessage(`Cannot upload more than ${maxFiles} files at once.`);
      return;
    }

    const nextFiles = [...files];

    for (const file of candidates) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!validExtensions.includes(ext)) {
        setErrorMessage(`Unsupported file format "${file.name}". Supported: .txt, .md, .json`);
        return;
      }

      if (file.size > maxBytes) {
        setErrorMessage(
          `File "${file.name}" exceeds the maximum limit of ${(maxBytes / (1024 * 1024)).toFixed(1)} MiB.`
        );
        return;
      }

      // Check if file already added
      if (!nextFiles.some((f) => f.name === file.name && f.size === file.size)) {
        nextFiles.push(file);
      }
    }

    onFilesChanged(nextFiles);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const removeFile = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    onFilesChanged(updated);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  };

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragOver
            ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-primary)] bg-[var(--color-surface)]'
        }`}
        role="button"
        tabIndex={0}
        aria-label="Upload files dropzone"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".txt,.md,.json"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              validateAndAddFiles(e.target.files);
            }
          }}
        />

        <svg
          className="mx-auto h-10 w-10 text-[var(--color-text-muted)] mb-2"
          stroke="currentColor"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>

        <p className="text-sm font-medium text-[var(--color-text)]">
          Drag and drop files here, or{' '}
          <span className="text-[var(--color-primary)] underline">browse</span>
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Supports .txt, .md, .json (relay envelopes) up to 5 MiB each (max 10 files)
        </p>
      </div>

      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md">
          {errorMessage}
        </div>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md overflow-hidden bg-[var(--color-surface)]">
          {files.map((file, idx) => (
            <li key={idx} className="flex items-center justify-between p-2.5 text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] uppercase">
                  {file.name.split('.').pop()}
                </span>
                <span className="truncate font-medium text-[var(--color-text)]">{file.name}</span>
                <span className="text-[var(--color-text-muted)]">
                  ({formatFileSize(file.size)})
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(idx);
                }}
                className="text-red-600 hover:text-red-800 p-1 rounded"
                aria-label={`Remove file ${file.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
