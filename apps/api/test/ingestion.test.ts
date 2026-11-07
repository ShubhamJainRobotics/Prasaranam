import { describe, it, expect } from 'vitest';
import {
  codePointLength,
  codePointSlice,
  sanitiseBuffer,
  sanitiseText,
  renderMessagesEnvelope,
  renderIssuesEnvelope,
  chunkTextOrMarkdown,
  ingestDocument,
  IngestionError,
  UPLOAD_MAX_BYTES,
  IMPORT_MAX_TOTAL_CHARACTERS,
} from '../src/ingestion/index.js';

describe('Ingestion Module: Unicode Code Points & Sanitisation', () => {
  it('codePointLength and codePointSlice handle multi-byte characters and emoji correctly', () => {
    // Single emoji (surrogate pairs in UTF-16, single code point in Unicode)
    const emojiStr = 'Hello 👍 World 🎉';
    expect(codePointLength(emojiStr)).toBe(15);
    expect(emojiStr.length).toBe(17); // UTF-16 code units

    // Slice using code-point offsets
    const slice = codePointSlice(emojiStr, 6, 7);
    expect(slice).toBe('👍');
    expect(codePointLength(slice)).toBe(1);

    // Combining characters
    const combining = 'e\u0301'; // é as e + acute accent
    expect(codePointLength(combining)).toBe(2);

    // Non-Latin scripts: Arabic, Devanagari, Japanese
    const arabic = 'مرحبا';
    expect(codePointLength(arabic)).toBe(5);

    const devanagari = 'नमस्ते';
    expect(codePointLength(devanagari)).toBe(6);

    const japanese = 'こんにちは';
    expect(codePointLength(japanese)).toBe(5);
  });

  it('sanitiseBuffer decodes valid UTF-8, strips leading BOM, and normalises newlines', () => {
    // Leading BOM + CRLF
    const rawWithBom = Buffer.from('\uFEFFLine 1\r\nLine 2\rLine 3\n', 'utf-8');
    const result = sanitiseBuffer(rawWithBom);

    expect(result).toBe('Line 1\nLine 2\nLine 3\n');
    expect(result.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('sanitiseBuffer rejects invalid UTF-8 bytes', () => {
    // 0xFF 0xFE is an invalid UTF-8 sequence
    const invalidBuffer = Buffer.from([0xff, 0xfe, 0x41, 0x42]);
    expect(() => sanitiseBuffer(invalidBuffer)).toThrow(IngestionError);
  });

  it('sanitiseText rejects NUL and forbidden C0 control characters', () => {
    // NUL byte
    expect(() => sanitiseText('Text with \0 NUL byte')).toThrow(IngestionError);

    // Bell character (0x07)
    expect(() => sanitiseText('Text with \x07 bell')).toThrow(IngestionError);

    // Escape character (0x1B)
    expect(() => sanitiseText('Text with \x1B esc')).toThrow(IngestionError);

    // DEL character (0x7F)
    expect(() => sanitiseText('Text with \x7F del')).toThrow(IngestionError);

    // Permitted controls: Tab and Newline
    const valid = 'Column 1\tColumn 2\nRow 2';
    expect(sanitiseText(valid)).toBe(valid);
  });

  it('does NOT collapse whitespace or alter canonical evidence content', () => {
    const raw = 'Text   with   multiple    spaces   and\n\n\nnewlines';
    const sanitised = sanitiseText(raw);
    expect(sanitised).toBe(raw);
  });
});

describe('Ingestion Module: Envelopes & Deterministic Serialization', () => {
  it('deterministically renders relay.messages.v1 envelope', () => {
    const envelope = {
      format: 'relay.messages.v1',
      records: [
        {
          id: 'm-001',
          text: 'We should use Postgres for the ledger.',
          author: 'Asha Rao',
          timestamp: '2026-03-02T10:15:00Z',
          url: null,
        },
        {
          id: 'm-002',
          text: 'Second message.',
          author: null,
          timestamp: null,
          url: 'https://relay.local/msg/2',
        },
      ],
    };

    const result = renderMessagesEnvelope(envelope);
    expect(result.kind).toBe('messages');
    expect(result.records.length).toBe(2);

    const expected =
      '[m-001] Asha Rao | 2026-03-02T10:15:00Z\n' +
      'We should use Postgres for the ledger.\n\n' +
      '[m-002] author not recorded | time not recorded\n' +
      'Second message.\n\n';

    expect(result.canonicalContent).toBe(expected);
  });

  it('deterministically renders relay.issues.v1 envelope', () => {
    const envelope = {
      format: 'relay.issues.v1',
      records: [
        {
          id: 'PAY-12',
          title: 'Sandbox credentials missing',
          description: 'Integration tests cannot run without credentials.',
          status: 'open',
          assignee: 'Asha Rao',
          updatedAt: '2026-03-04T09:00:00Z',
          url: null,
        },
      ],
    };

    const result = renderIssuesEnvelope(envelope);
    expect(result.kind).toBe('issues');

    const expected =
      '[PAY-12] Sandbox credentials missing | status: open | assignee: Asha Rao | updated: 2026-03-04T09:00:00Z\n' +
      'Integration tests cannot run without credentials.\n\n';

    expect(result.canonicalContent).toBe(expected);
  });

  it('rejects envelope with duplicate record IDs', () => {
    const duplicate = {
      format: 'relay.messages.v1',
      records: [
        { id: 'dup-1', text: 'First' },
        { id: 'dup-1', text: 'Second' },
      ],
    };
    expect(() => renderMessagesEnvelope(duplicate)).toThrow(IngestionError);
  });

  it('rejects format mismatch when selecting messages vs issues', () => {
    const rawJson = JSON.stringify({
      format: 'relay.messages.v1',
      records: [{ id: 'm-1', text: 'Hi' }],
    });

    expect(() => ingestDocument(rawJson, { kind: 'issues' })).toThrow(/Format mismatch/);
  });
});

describe('Ingestion Module: Paragraph & JSON Chunking', () => {
  it('packs whole paragraphs into chunks up to 1500 code points', () => {
    const para1 = 'First paragraph discussing database options.';
    const para2 = 'Second paragraph discussing transaction isolation.';
    const content = `${para1}\n\n${para2}`;

    const chunks = chunkTextOrMarkdown(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(content);
    expect(chunks[0].startOffset).toBe(0);
    expect(chunks[0].endOffset).toBe(codePointLength(content));
    expect(codePointLength(chunks[0].content)).toBe(chunks[0].endOffset - chunks[0].startOffset);
  });

  it('splits single paragraph longer than 1500 code points and preserves invariants', () => {
    // Create an oversized paragraph with line breaks and sentence ends
    const sentence = 'This is a detailed architectural explanation with multi-byte emoji 🎉. ';
    const longPara = sentence.repeat(40); // ~2880 code points

    expect(codePointLength(longPara)).toBeGreaterThan(1500);

    const chunks = chunkTextOrMarkdown(longPara);
    expect(chunks.length).toBeGreaterThan(1);

    // Verify all chunk invariants
    for (const chunk of chunks) {
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      expect(chunk.endOffset - chunk.startOffset).toBeLessThanOrEqual(1500);
      expect(codePointLength(chunk.content)).toBe(chunk.endOffset - chunk.startOffset);
      // Slice from original content must match chunk content exactly
      expect(codePointSlice(longPara, chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
    }
  });

  it('chunks JSON records one-to-one when within 1500 code points', () => {
    const rawEnvelope = JSON.stringify({
      format: 'relay.messages.v1',
      records: [
        { id: 'm-1', text: 'Message 1' },
        { id: 'm-2', text: 'Message 2' },
      ],
    });

    const result = ingestDocument(rawEnvelope, { kind: 'messages' });
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0].recordRef).toBe('m-1');
    expect(result.chunks[1].recordRef).toBe('m-2');

    // Verify invariants
    for (const chunk of result.chunks) {
      expect(codePointLength(chunk.content)).toBe(chunk.endOffset - chunk.startOffset);
      expect(codePointSlice(result.canonicalContent, chunk.startOffset, chunk.endOffset)).toBe(
        chunk.content
      );
    }
  });
});

describe('Ingestion Module: Section 9.2 Limits', () => {
  it('rejects file larger than 5 MiB', () => {
    const largeBuffer = Buffer.alloc(UPLOAD_MAX_BYTES + 1, 'a');
    expect(() => ingestDocument(largeBuffer, { kind: 'text' })).toThrow(IngestionError);
  });

  it('rejects pasted text exceeding 5 MiB', () => {
    const largeText = 'x'.repeat(UPLOAD_MAX_BYTES + 1);
    expect(() => ingestDocument(largeText, { kind: 'text' })).toThrow(IngestionError);
  });

  it('rejects content exceeding 2,000,000 characters limit', () => {
    const tooManyChars = 'x'.repeat(IMPORT_MAX_TOTAL_CHARACTERS + 10);
    expect(() => ingestDocument(tooManyChars, { kind: 'text' })).toThrow(
      /exceeds limit of 2000000 characters/
    );
  });

  it('rejects JSON file with more than 10,000 records', () => {
    const records = [];
    for (let i = 0; i < 10001; i++) {
      records.push({ id: `rec-${i}`, text: 'Hello' });
    }
    const raw = JSON.stringify({ format: 'relay.messages.v1', records });

    expect(() => ingestDocument(raw, { kind: 'messages' })).toThrow(
      /File cannot contain more than 10,000 records/
    );
  });

  it('rejects individual JSON record exceeding 100,000 characters', () => {
    const raw = JSON.stringify({
      format: 'relay.messages.v1',
      records: [
        {
          id: 'huge-rec',
          text: 'a'.repeat(100001),
        },
      ],
    });

    expect(() => ingestDocument(raw, { kind: 'messages' })).toThrow(
      /Record text must not exceed 100,000 characters/
    );
  });
});
