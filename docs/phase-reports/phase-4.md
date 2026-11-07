# Phase 4 Report: Ingestion and Evidence

## 1. Implemented
- **Ingestion Engine (`apps/api/src/ingestion`)**:
  - Strict UTF-8 decoding (`TextDecoder('utf-8', { fatal: true })`), single leading BOM stripping (`\uFEFF`), newline normalisation (`\r\n` / `\r` to `\n`), rejection of NUL and forbidden C0 control characters, and strict rejection of binary content.
  - Zero-based Unicode code-point offset handling (`[...str].length`) across JavaScript and PostgreSQL, tested against emoji (`👍`, `🎉`, `👩‍💻`), combining marks (`e\u0301`), and non-Latin scripts (Arabic, Devanagari, Japanese).
  - Deterministic canonical rendering for JSON envelopes `relay.messages.v1` and `relay.issues.v1`.
  - Content SHA-256 calculation over canonical UTF-8 bytes.
  - Chunker (`chunker.ts`): paragraph packing up to 1,500 code points for text/markdown; single paragraph splitting (line break -> sentence end -> whitespace -> hard-split); JSON record chunking preserving provenance (`record_ref`, `author_label`, `event_at`, `original_url`).
  - Section 9.2 limit enforcement: 5 MiB file limit, 10 files max, 10,000 JSON records max, 100,000 characters per record max, 2,000,000 characters total extracted text limit.
  - Untrusted URL preservation without outbound fetching.
- **Database Migrations (`supabase/migrations`)**:
  - `20261107100018_source_ingestion_functions.sql` and `20261107100019_fix_source_ingestion_audit_calls.sql`:
    - `app_private.import_source`: Transactionally inserts source, chunks, and automatic importer grant if restricted. Enforces trigger validation (`source_chunks_validate_chunk`), supports replace-by-revision (`replaces_source_id`), archives prior version, and audits action.
    - `app_private.set_source_access`: Owner-only visibility and grant modification, invalidating project access epoch.
    - `app_private.archive_source`: Owner-only soft-deletion, invalidating project access epoch.
- **Shared Contracts (`packages/contracts`)**:
  - Added `SourceKindSchema`, `SourceVisibilitySchema`, `SourceProcessingStatusSchema`, `MessageRecordSchema`, `MessagesEnvelopeSchema`, `IssueRecordSchema`, `IssuesEnvelopeSchema`, `PasteSourceInputSchema`, `SetSourceAccessSchema`, `SourceChunkSchema`, `SourceSummarySchema`, and `SourceDetailSchema`.
  - Generated 12 additional committed JSON Schemas in `packages/contracts/schemas` (46 total).
- **Backend API Routes (`apps/api/src/routes/sources.ts`)**:
  - `POST /api/v1/projects/:id/sources/import`: Handles multipart file uploads (via `multer` memory storage) and JSON paste payloads.
  - `GET /api/v1/projects/:id/sources`: Cursor-paginated accessible sources enforcing `can_read_source` and RLS.
  - `GET /api/v1/sources/:id`: Authorised source detail and canonical content (404 on inaccessible).
  - `GET /api/v1/sources/:id/chunks`: Authorised chunk listing with code-point offset bounds (404 on inaccessible).
  - `PATCH /api/v1/sources/:id/access`: Owner-only access policy change.
  - `POST /api/v1/sources/:id/archive`: Owner-only source archival.
- **Web UI (`apps/web`)**:
  - Routes: `/app/projects/:projectId/sources` (`ProjectSourcesPage`) and `/app/projects/:projectId/sources/:sourceId` (`SourceDetailPage`).
  - Components: `ImportWizard`, `FileDropzone`, `ImportFormatHelp`, `SourceTable`, `SourceAccessBadge`, `SourceAccessEditor`, `SourceViewer`, `ChunkHighlighter`.
  - Safe rendering: All source content rendered strictly as text (`whitespace-pre-wrap` with React escaping; zero raw HTML injection).
  - Interactive highlighting: Code-point-accurate span highlighting using `<mark>` elements without HTML parsing.
- **Downloadable Examples & Documentation**:
  - Sample files in `apps/web/public/examples/`: `messages.v1.json`, `issues.v1.json`, `sample.md`, `sample.txt`.
  - Complete format specification in `docs/import-formats.md`.
- **Synthetic Demo Seed Script (`scripts/seed-demo.ts`, `npm run demo:seed`)**:
  - Implements Section 22.4 and Section 2A.15 rules: refuses production and non-local Supabase hosts.
  - Creates 5 local identities with generated secure passwords printed once to terminal.
  - Seeds synthetic "Payments Infrastructure" project with database proposal, approved ADR, sandbox credentials blocker, ownerless task, conflicting Friday/Monday statements, completed task, task dependency, malicious prompt injection attempt, and restricted budget note.

## 2. Commands Run
- `npx supabase migration up`: PASSED (Applied `20261107100018_source_ingestion_functions.sql` and `20261107100019_fix_source_ingestion_audit_calls.sql`).
- `npm run demo:seed`: PASSED (Synthetic identities, payments project, and 9 synthetic sources created idempotently).
- `npm run schemas:generate`: PASSED (Generated 46 JSON schemas in `packages/contracts/schemas`).
- `npm run format`: PASSED (Formatted all modified files with Prettier).
- `npm run format:check`: PASSED (All files verified clean with Prettier).
- `npm run typecheck`: PASSED (Root `tsc --build` compiled all workspaces cleanly).
- `npm run lint`: PASSED (0 errors, 0 warnings across all workspaces).
- `npm run test`: PASSED (3 test suites, 42 tests passed in 478ms).
- `npm run test:integration`: PASSED (6 test suites, 46 tests passed in 1.45s).
- `npm run test:security`: PASSED (9 test suites, 54 tests passed in 1.60s).
- `npm run test:e2e`: PASSED (4 test suites, 4 tests passed in 6.0s).
- `npm run build`: PASSED (All workspaces built cleanly; production web bundle contains no secrets).

## 3. Exit Criteria
- **Inspectable imports**: MET (`tests/integration/sources-routes.test.ts` imports plain text, markdown, messages, issues, and downloadable example files; `GET /sources/:id` and `GET /sources/:id/chunks` return full metadata and chunk records).
- **Exact highlighting**: MET (`tests/e2e/sources.spec.ts` verifies interactive chunk highlighting in browser; `apps/api/test/ingestion.test.ts` validates zero-based code-point offset matching with emoji, combining marks, and non-Latin scripts).
- **Restricted metadata hidden**: MET (`tests/security/sources-security.test.ts` proves that ungranted project members receive 404 for restricted sources, restricted sources are excluded from project listings, and counts exclude inaccessible sources).

## 4. Decisions and Spec Issues Recorded
- **Replace-by-revision permissions**: Re-importing with `replaces_source_id` archives the prior source version and increments the project access epoch. Per Section 2A.2 line 79, source archival requires project owner role; following Rule 5, replace-by-revision is restricted to project owners to prevent privilege escalation.
- **Audit event schema alignment**: Corrected column references in `import_source`, `set_source_access`, and `archive_source` to use `app_private.write_audit_event` with `entity_type` and `entity_id` columns, matching `public.audit_events`.
- **Title inheritance**: With single file uploads, form title applies if provided; with multi-file uploads, each source title defaults to its file basename per Section 2A.7.
- Recorded in `docs/decisions.md` under Decisions and Spec Issues.

## 5. Known Limitations
- Initial release supports file uploads (`.txt`, `.md`, `.json`) and pasted text; live Slack, GitHub, Jira, or Notion direct integrations are not enabled.
- External URLs supplied with imports are stored purely as metadata strings and are never fetched by the server.
- Relationships and conflicts analysis over ingested evidence will be executed in Phase 5.
