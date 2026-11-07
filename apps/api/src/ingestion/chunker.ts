import { codePointLength, codePointSlice } from './unicode.js';
import type { RenderedRecord } from './envelopes.js';

export const CHUNK_MAX_CHARACTERS = 1500;

export interface GeneratedChunk {
  ordinal: number;
  recordRef: string | null;
  authorLabel: string | null;
  eventAt: string | null;
  originalUrl: string | null;
  startOffset: number;
  endOffset: number;
  content: string;
}

export interface ChunkSourceMetadata {
  recordRef?: string | null;
  authorLabel?: string | null;
  eventAt?: string | null;
  originalUrl?: string | null;
}

/**
 * Splits an oversized block of text (longer than maxChars code points)
 * into multiple chunks using the hierarchy:
 * 1. Line break (\n)
 * 2. Sentence end (. , ! , ? )
 * 3. Whitespace (\s)
 * 4. Hard split at maxChars
 */
function splitOversizedBlock(
  canonicalContent: string,
  blockStartOffset: number,
  blockContent: string,
  metadata: ChunkSourceMetadata,
  startOrdinal: number,
  maxChars = CHUNK_MAX_CHARACTERS
): GeneratedChunk[] {
  const chunks: GeneratedChunk[] = [];
  const codePoints = [...blockContent];
  let localOffset = 0;
  let ordinal = startOrdinal;

  while (localOffset < codePoints.length) {
    const remainingCount = codePoints.length - localOffset;

    if (remainingCount <= maxChars) {
      const sliceCodePoints = codePoints.slice(localOffset);
      const content = sliceCodePoints.join('');
      const startOffset = blockStartOffset + localOffset;
      const endOffset = startOffset + sliceCodePoints.length;

      // Invariant check against canonical content
      const verifiedContent = codePointSlice(canonicalContent, startOffset, endOffset);
      if (verifiedContent !== content) {
        throw new Error(
          `Chunk invariant violation at [${startOffset}, ${endOffset}]: content does not match canonical slice`
        );
      }

      chunks.push({
        ordinal: ordinal++,
        recordRef: metadata.recordRef ?? null,
        authorLabel: metadata.authorLabel ?? null,
        eventAt: metadata.eventAt ?? null,
        originalUrl: metadata.originalUrl ?? null,
        startOffset,
        endOffset,
        content,
      });
      break;
    }

    // Must split: look within the first maxChars code points
    const windowCodePoints = codePoints.slice(localOffset, localOffset + maxChars);
    const windowStr = windowCodePoints.join('');
    let splitIdx = -1;

    // 1. Last line break before limit
    const lastNewline = windowStr.lastIndexOf('\n');
    if (lastNewline > 0) {
      splitIdx = lastNewline + 1; // split after the newline
    }

    // 2. Last sentence end before limit
    if (splitIdx <= 0) {
      // Find sentence terminators followed by space or newline
      const sentenceRegex = /[.!?](\s|$)/g;
      let match: RegExpExecArray | null;
      let lastSentenceEnd = -1;
      while ((match = sentenceRegex.exec(windowStr)) !== null) {
        lastSentenceEnd = match.index + 1; // split right after the punctuation mark
      }
      if (lastSentenceEnd > 0) {
        splitIdx = lastSentenceEnd;
      }
    }

    // 3. Last whitespace before limit
    if (splitIdx <= 0) {
      const whitespaceRegex = /\s/g;
      let match: RegExpExecArray | null;
      let lastWhitespace = -1;
      while ((match = whitespaceRegex.exec(windowStr)) !== null) {
        lastWhitespace = match.index;
      }
      if (lastWhitespace > 0) {
        splitIdx = lastWhitespace; // split at whitespace
      }
    }

    // 4. Hard split at limit
    if (splitIdx <= 0 || splitIdx >= maxChars) {
      splitIdx = maxChars;
    }

    // Emit chunk for the slice
    const chunkCodePoints = codePoints.slice(localOffset, localOffset + splitIdx);
    const content = chunkCodePoints.join('');
    const startOffset = blockStartOffset + localOffset;
    const endOffset = startOffset + chunkCodePoints.length;

    const verifiedContent = codePointSlice(canonicalContent, startOffset, endOffset);
    if (verifiedContent !== content) {
      throw new Error(
        `Chunk invariant violation at [${startOffset}, ${endOffset}]: content does not match canonical slice`
      );
    }

    chunks.push({
      ordinal: ordinal++,
      recordRef: metadata.recordRef ?? null,
      authorLabel: metadata.authorLabel ?? null,
      eventAt: metadata.eventAt ?? null,
      originalUrl: metadata.originalUrl ?? null,
      startOffset,
      endOffset,
      content,
    });

    localOffset += splitIdx;

    // Advance past single whitespace separator if present at split point
    if (localOffset < codePoints.length && /\s/.test(codePoints[localOffset]!)) {
      // Per Section 2A.6 item 4: whitespace separator may be left out
      localOffset++;
    }
  }

  return chunks;
}

/**
 * Chunker for text and markdown sources.
 * Packs whole paragraphs (separated by blank lines) into chunks up to CHUNK_MAX_CHARACTERS.
 * Splits paragraphs longer than CHUNK_MAX_CHARACTERS.
 */
export function chunkTextOrMarkdown(
  canonicalContent: string,
  sourceMetadata: ChunkSourceMetadata = {},
  maxChars = CHUNK_MAX_CHARACTERS
): GeneratedChunk[] {
  if (!canonicalContent) {
    return [];
  }

  // Find paragraphs and their offsets in code points
  // Paragraphs are separated by two or more newlines: \n\n+
  const paragraphs: { start: number; end: number; content: string }[] = [];

  // Match paragraphs using regex on content
  const paraRegex = /\S[\s\S]*?(?=(?:\n\s*\n)|$)/g;
  let match: RegExpExecArray | null;

  while ((match = paraRegex.exec(canonicalContent)) !== null) {
    const rawMatch = match[0];
    if (!rawMatch || !rawMatch.trim()) continue;

    // Convert string char index to code point offset
    const preStr = canonicalContent.slice(0, match.index);
    const startCp = codePointLength(preStr);
    const lenCp = codePointLength(rawMatch);

    paragraphs.push({
      start: startCp,
      end: startCp + lenCp,
      content: rawMatch,
    });
  }

  if (paragraphs.length === 0) {
    // If no paragraphs matched (e.g. whitespace only), return single slice or empty
    const trimmedLen = codePointLength(canonicalContent.trim());
    if (trimmedLen === 0) return [];
    return splitOversizedBlock(canonicalContent, 0, canonicalContent, sourceMetadata, 0, maxChars);
  }

  const chunks: GeneratedChunk[] = [];
  let currentGroup: { start: number; end: number; content: string }[] = [];
  let currentOrdinal = 0;

  function flushGroup() {
    if (currentGroup.length === 0) return;
    const first = currentGroup[0]!;
    const last = currentGroup[currentGroup.length - 1]!;
    const startOffset = first.start;
    const endOffset = last.end;
    const content = codePointSlice(canonicalContent, startOffset, endOffset);

    // Verify invariants
    if (codePointLength(content) !== endOffset - startOffset) {
      throw new Error('Chunk length invariant mismatch in paragraph group');
    }

    chunks.push({
      ordinal: currentOrdinal++,
      recordRef: sourceMetadata.recordRef ?? null,
      authorLabel: sourceMetadata.authorLabel ?? null,
      eventAt: sourceMetadata.eventAt ?? null,
      originalUrl: sourceMetadata.originalUrl ?? null,
      startOffset,
      endOffset,
      content,
    });
    currentGroup = [];
  }

  for (const para of paragraphs) {
    const paraLen = para.end - para.start;

    if (paraLen > maxChars) {
      // Flush any pending paragraphs first
      flushGroup();
      // Split the single oversized paragraph
      const subChunks = splitOversizedBlock(
        canonicalContent,
        para.start,
        para.content,
        sourceMetadata,
        currentOrdinal,
        maxChars
      );
      chunks.push(...subChunks);
      currentOrdinal += subChunks.length;
      continue;
    }

    // Check if adding this paragraph to currentGroup exceeds maxChars
    if (currentGroup.length > 0) {
      const first = currentGroup[0]!;
      const potentialEnd = para.end;
      const potentialLen = potentialEnd - first.start;

      if (potentialLen <= maxChars) {
        currentGroup.push(para);
      } else {
        flushGroup();
        currentGroup.push(para);
      }
    } else {
      currentGroup.push(para);
    }
  }

  flushGroup();
  return chunks;
}

/**
 * Chunker for JSON imports (messages and issues).
 * One chunk per record when rendered record fits limit;
 * longer records split by same rule, all parts keeping the same record_ref.
 * Records are never merged into one chunk.
 */
export function chunkJsonRecords(
  canonicalContent: string,
  records: RenderedRecord[],
  maxChars = CHUNK_MAX_CHARACTERS
): GeneratedChunk[] {
  const chunks: GeneratedChunk[] = [];
  let currentOffset = 0;
  let ordinal = 0;

  for (const record of records) {
    const recordCodePointLen = codePointLength(record.renderedText);
    const startOffset = currentOffset;
    const endOffset = startOffset + recordCodePointLen;

    // Verify slice matches record.renderedText
    const recordContent = codePointSlice(canonicalContent, startOffset, endOffset);
    if (recordContent !== record.renderedText) {
      throw new Error(
        `Invariant error: record ${record.recordRef} content mismatch at offset ${startOffset}`
      );
    }

    // Trim trailing blank lines (\n\n) for the chunk content if present
    // Per Section 2A.6 item 4: whitespace-only separators between chunks may be left out
    let trimmedContent = record.renderedText;
    let trimmedEndOffset = endOffset;
    if (trimmedContent.endsWith('\n\n')) {
      trimmedContent = trimmedContent.slice(0, -2);
      trimmedEndOffset = endOffset - 2;
    } else if (trimmedContent.endsWith('\n')) {
      trimmedContent = trimmedContent.slice(0, -1);
      trimmedEndOffset = endOffset - 1;
    }

    const chunkLen = codePointLength(trimmedContent);
    const metadata: ChunkSourceMetadata = {
      recordRef: record.recordRef,
      authorLabel: record.authorLabel,
      eventAt: record.eventAt,
      originalUrl: record.originalUrl,
    };

    if (chunkLen <= maxChars) {
      chunks.push({
        ordinal: ordinal++,
        recordRef: record.recordRef,
        authorLabel: record.authorLabel,
        eventAt: record.eventAt,
        originalUrl: record.originalUrl,
        startOffset,
        endOffset: trimmedEndOffset,
        content: trimmedContent,
      });
    } else {
      // Split oversized record
      const subChunks = splitOversizedBlock(
        canonicalContent,
        startOffset,
        trimmedContent,
        metadata,
        ordinal,
        maxChars
      );
      chunks.push(...subChunks);
      ordinal += subChunks.length;
    }

    currentOffset = endOffset;
  }

  return chunks;
}
