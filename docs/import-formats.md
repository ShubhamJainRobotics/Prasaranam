# Relay Source Import Formats Specification

This document details the source ingestion formats supported by Relay, their canonical representations, chunking rules, character limits, and security constraints in accordance with `docs/SPEC.md` Sections 2A.6, 2A.7, 4.2, and 9.2.

---

## 1. Supported Formats Overview

Relay supports four source ingestion formats:

1. **Plain Text (`text`)**: Files with `.txt` extension or pasted text.
2. **Markdown (`markdown`)**: Files with `.md` extension or pasted markdown.
3. **Messages Envelope (`relay.messages.v1`)**: Structured JSON exports for chat or asynchronous communication logs.
4. **Issues Envelope (`relay.issues.v1`)**: Structured JSON exports for issue trackers and task backlogs.

---

## 2. Ingestion Limits (SPEC Section 9.2)

- **Maximum file upload size**: 5 MiB (`UPLOAD_MAX_BYTES = 5,242,880 bytes`).
- **Maximum files per request**: 10 files (`UPLOAD_MAX_FILES = 10`).
- **Maximum characters per pasted note**: 5 MiB equivalent in UTF-8 bytes.
- **Maximum total extracted text per request**: 2,000,000 Unicode code points across all documents.
- **Maximum records per JSON file**: 10,000 records (`IMPORT_MAX_JSON_RECORDS = 10,000`).
- **Maximum characters per JSON record**: 100,000 characters per individual record body.
- **Title bounds**: 1 to 200 characters. Single-file imports inherit the form title if provided; multi-file imports use each file's basename. Pasted text requires an explicit title.
- **URLs**: Must use `http` or `https` protocols only, bounded to 2,048 characters. Uploaded URLs are stored purely as metadata strings and are **never fetched** by the server.

---

## 3. Sanitisation and Encoding (SPEC Section 2A.6)

1. **Strict UTF-8 Decoding**: All uploads are decoded using `TextDecoder('utf-8', { fatal: true })`. Invalid byte sequences are rejected with HTTP `422 VALIDATION_ERROR`.
2. **BOM Stripping**: Exactly one leading Byte Order Mark (`\uFEFF`) is stripped if present.
3. **Newline Normalisation**: `\r\n` and `\r` are normalised to `\n`.
4. **Control Character Rejection**: Any NUL character (`\0`) and any C0 control character other than tab (`\t`, `0x09`) and newline (`\n`, `0x0A`), plus DEL (`0x7F`), is strictly rejected with HTTP `422`.
5. **No Unicode Normalisation**: Content is preserved verbatim without NFC/NFD transformations, trimming, or collapsing to ensure exact byte-for-byte evidence quotation fidelity.

---

## 4. JSON Envelope Specifications (SPEC Section 2A.7)

### 4.1 Messages Envelope (`relay.messages.v1`)

```json
{
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
}
```

#### Fields

- `format` (string, required): Exactly `"relay.messages.v1"`.
- `records` (array, required): 1 to 10,000 record objects.
- `id` (string, required): 1 to 200 characters, unique within the file.
- `text` (string, required): 1 to 100,000 characters.
- `author` (string | null): Up to 200 characters.
- `timestamp` (string | null): ISO-8601 timestamp with `Z` or explicit timezone offset (e.g. `+02:00`).
- `url` (string | null): Valid `http` or `https` URL, at most 2,048 characters.

#### Canonical Rendering

Each record is canonically formatted as:

```text
[<id>] <author, or "author not recorded"> | <timestamp, or "time not recorded">
<text>

```

(Header line, newline, text, followed by a blank line).

---

### 4.2 Issues Envelope (`relay.issues.v1`)

```json
{
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
}
```

#### Fields

- `format` (string, required): Exactly `"relay.issues.v1"`.
- `records` (array, required): 1 to 10,000 record objects.
- `id` (string, required): 1 to 200 characters, unique within the file.
- `title` (string, required): 1 to 1,000 characters.
- `description` (string, required): Up to 100,000 characters.
- `status` (string, required): 1 to 100 characters.
- `assignee` (string | null): Up to 200 characters.
- `updatedAt` (string | null): ISO-8601 timestamp with `Z` or explicit offset.
- `url` (string | null): Valid `http` or `https` URL, at most 2,048 characters.

#### Canonical Rendering

Each record is canonically formatted as:

```text
[<id>] <title> | status: <status> | assignee: <assignee, or "none recorded"> | updated: <updatedAt, or "time not recorded">
<description>

```

(Header line, newline, description, followed by a blank line).

---

## 5. Unicode Code-Point Offsets and Chunking (SPEC Section 2A.6)

1. **Code-Point Offsets**: All `start_offset` and `end_offset` values are zero-based indices in Unicode code points (`[...str].length`), not UTF-16 code units or byte counts. This aligns with PostgreSQL `char_length(content)` and `substring()`.
2. **Chunk Size**: At most `CHUNK_MAX_CHARACTERS` (1500) code points per chunk.
3. **Text and Markdown Chunking**:
   - Whole paragraphs separated by blank lines (`\n\n+`) are packed into chunks up to 1500 code points.
   - Paragraphs longer than 1500 code points are split at the last line break, sentence boundary, or whitespace before the limit, with hard-splitting as fallback.
   - Whitespace separators between chunks are omitted.
4. **JSON Chunking**:
   - Exactly one chunk per record when the rendered record fits within 1500 code points.
   - Oversized records are split using the paragraph splitting hierarchy; all sub-chunks retain the record's `record_ref`, `author_label`, `event_at`, and `original_url`.
   - Records are never merged into a single chunk.

---

## 6. Downloadable Sample Files

Sample files are available in `apps/web/public/examples/`:

- [`messages.v1.json`](file:///home/shubham/Relay/apps/web/public/examples/messages.v1.json)
- [`issues.v1.json`](file:///home/shubham/Relay/apps/web/public/examples/issues.v1.json)
- [`sample.md`](file:///home/shubham/Relay/apps/web/public/examples/sample.md)
- [`sample.txt`](file:///home/shubham/Relay/apps/web/public/examples/sample.txt)
