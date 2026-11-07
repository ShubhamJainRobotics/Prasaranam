import { MessagesEnvelopeSchema, IssuesEnvelopeSchema } from '@relay/contracts';
import { IngestionError } from './sanitiser.js';

export interface RenderedRecord {
  recordRef: string;
  authorLabel: string | null;
  eventAt: string | null;
  originalUrl: string | null;
  renderedText: string;
}

export interface ParsedEnvelopeResult {
  kind: 'messages' | 'issues';
  canonicalContent: string;
  records: RenderedRecord[];
}

/**
 * Validates and canonically renders a messages JSON envelope (relay.messages.v1).
 * SPEC Section 2A.7:
 * [<id>] <author, or "author not recorded"> | <timestamp, or "time not recorded">
 * <text>
 * (followed by a blank line)
 */
export function renderMessagesEnvelope(rawJson: unknown): ParsedEnvelopeResult {
  const parseResult = MessagesEnvelopeSchema.safeParse(rawJson);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    throw new IngestionError(
      `Invalid messages envelope: ${issue?.message || 'schema mismatch'}`,
      'VALIDATION_ERROR',
      422
    );
  }

  const envelope = parseResult.data;
  const records: RenderedRecord[] = [];
  let canonicalContent = '';

  for (const r of envelope.records) {
    const authorStr = r.author?.trim() || 'author not recorded';
    const timeStr = r.timestamp || 'time not recorded';
    const header = `[${r.id}] ${authorStr} | ${timeStr}`;
    const rendered = `${header}\n${r.text}\n\n`;

    records.push({
      recordRef: r.id,
      authorLabel: r.author || null,
      eventAt: r.timestamp || null,
      originalUrl: r.url || null,
      renderedText: rendered,
    });

    canonicalContent += rendered;
  }

  return {
    kind: 'messages',
    canonicalContent,
    records,
  };
}

/**
 * Validates and canonically renders an issues JSON envelope (relay.issues.v1).
 * SPEC Section 2A.7:
 * [<id>] <title> | status: <status> | assignee: <assignee, or "none recorded"> | updated: <updatedAt, or "time not recorded">
 * <description>
 * (followed by a blank line)
 */
export function renderIssuesEnvelope(rawJson: unknown): ParsedEnvelopeResult {
  const parseResult = IssuesEnvelopeSchema.safeParse(rawJson);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    throw new IngestionError(
      `Invalid issues envelope: ${issue?.message || 'schema mismatch'}`,
      'VALIDATION_ERROR',
      422
    );
  }

  const envelope = parseResult.data;
  const records: RenderedRecord[] = [];
  let canonicalContent = '';

  for (const r of envelope.records) {
    const assigneeStr = r.assignee?.trim() || 'none recorded';
    const updatedStr = r.updatedAt || 'time not recorded';
    const header = `[${r.id}] ${r.title} | status: ${r.status} | assignee: ${assigneeStr} | updated: ${updatedStr}`;
    const desc = r.description ?? '';
    const rendered = `${header}\n${desc}\n\n`;

    records.push({
      recordRef: r.id,
      authorLabel: r.assignee || null,
      eventAt: r.updatedAt || null,
      originalUrl: r.url || null,
      renderedText: rendered,
    });

    canonicalContent += rendered;
  }

  return {
    kind: 'issues',
    canonicalContent,
    records,
  };
}
