import crypto from 'node:crypto';
import { sanitiseBuffer, sanitiseText, IngestionError } from './sanitiser.js';
import { renderMessagesEnvelope, renderIssuesEnvelope } from './envelopes.js';
import {
  chunkTextOrMarkdown,
  chunkJsonRecords,
  type GeneratedChunk,
  type ChunkSourceMetadata,
} from './chunker.js';
import { codePointLength } from './unicode.js';

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
export const IMPORT_MAX_TOTAL_CHARACTERS = 2000000; // 2 million characters
export const IMPORT_MAX_FILES = 10;
export const IMPORT_MAX_JSON_RECORDS = 10000;
export const IMPORT_MAX_RECORD_CHARACTERS = 100000;

export interface IngestOptions {
  kind: 'text' | 'markdown' | 'messages' | 'issues';
  title?: string;
  authorLabel?: string;
  eventAt?: string;
  originalUrl?: string;
}

export interface IngestResult {
  kind: 'text' | 'markdown' | 'messages' | 'issues';
  canonicalContent: string;
  contentSha256: string;
  chunks: GeneratedChunk[];
}

/**
 * Ingests a document from a raw Buffer (e.g. file upload) or string (e.g. pasted text).
 * Applies all validation, sanitisation, canonical rendering, SHA-256 calculation, and chunking.
 */
export function ingestDocument(rawInput: Buffer | string, options: IngestOptions): IngestResult {
  let sanitisedText: string;

  if (Buffer.isBuffer(rawInput)) {
    if (rawInput.byteLength > UPLOAD_MAX_BYTES) {
      throw new IngestionError(
        `File exceeds maximum size of 5 MiB (${rawInput.byteLength} bytes)`,
        'PAYLOAD_TOO_LARGE',
        413
      );
    }
    sanitisedText = sanitiseBuffer(rawInput);
  } else {
    // String input (pasted text)
    const byteLen = Buffer.byteLength(rawInput, 'utf-8');
    if (byteLen > UPLOAD_MAX_BYTES) {
      throw new IngestionError(
        `Pasted text exceeds maximum size of 5 MiB (${byteLen} bytes)`,
        'PAYLOAD_TOO_LARGE',
        413
      );
    }
    sanitisedText = sanitiseText(rawInput);
  }

  // Check total character limit
  const totalCharacters = codePointLength(sanitisedText);
  if (totalCharacters > IMPORT_MAX_TOTAL_CHARACTERS) {
    throw new IngestionError(
      `Content exceeds limit of ${IMPORT_MAX_TOTAL_CHARACTERS} characters (found ${totalCharacters})`,
      'VALIDATION_ERROR',
      422
    );
  }

  let canonicalContent: string;
  let chunks: GeneratedChunk[];

  if (options.kind === 'messages') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sanitisedText);
    } catch {
      throw new IngestionError(
        'Invalid JSON format for messages envelope',
        'VALIDATION_ERROR',
        422
      );
    }

    // Verify envelope format matches selected kind (Section 2A.7)
    if (typeof parsed === 'object' && parsed !== null && 'format' in parsed) {
      if ((parsed as { format: unknown }).format !== 'relay.messages.v1') {
        throw new IngestionError(
          `Format mismatch: expected relay.messages.v1 but got '${(parsed as { format: unknown }).format}'`,
          'VALIDATION_ERROR',
          422
        );
      }
    }

    const renderedEnvelope = renderMessagesEnvelope(parsed);
    canonicalContent = renderedEnvelope.canonicalContent;
    chunks = chunkJsonRecords(canonicalContent, renderedEnvelope.records);
  } else if (options.kind === 'issues') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sanitisedText);
    } catch {
      throw new IngestionError('Invalid JSON format for issues envelope', 'VALIDATION_ERROR', 422);
    }

    // Verify envelope format matches selected kind (Section 2A.7)
    if (typeof parsed === 'object' && parsed !== null && 'format' in parsed) {
      if ((parsed as { format: unknown }).format !== 'relay.issues.v1') {
        throw new IngestionError(
          `Format mismatch: expected relay.issues.v1 but got '${(parsed as { format: unknown }).format}'`,
          'VALIDATION_ERROR',
          422
        );
      }
    }

    const renderedEnvelope = renderIssuesEnvelope(parsed);
    canonicalContent = renderedEnvelope.canonicalContent;
    chunks = chunkJsonRecords(canonicalContent, renderedEnvelope.records);
  } else {
    // text or markdown
    canonicalContent = sanitisedText;
    if (canonicalContent.trim().length === 0) {
      throw new IngestionError('Source content cannot be empty', 'VALIDATION_ERROR', 422);
    }

    const sourceMetadata: ChunkSourceMetadata = {
      authorLabel: options.authorLabel,
      eventAt: options.eventAt,
      originalUrl: options.originalUrl,
    };
    chunks = chunkTextOrMarkdown(canonicalContent, sourceMetadata);
  }

  // Calculate SHA-256 of canonical UTF-8 bytes (Section 2A.6 item 2)
  const contentSha256 = crypto
    .createHash('sha256')
    .update(Buffer.from(canonicalContent, 'utf-8'))
    .digest('hex');

  return {
    kind: options.kind,
    canonicalContent,
    contentSha256,
    chunks,
  };
}
