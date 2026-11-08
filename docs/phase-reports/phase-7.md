# Phase 7 Report: Evidence-Grounded Q&A and Export

## 1. Implemented

- **Database Migrations and Transactional Functions (`supabase/migrations/20261107100024_phase7_qa_and_conversations.sql`)**:
  - `app_private.create_conversation`: Transactionally creates a project-scoped conversation, validates active project membership, snapshots the current project access epoch, ensures caller isolation, and returns conversation metadata.
  - `app_private.record_message`: Atomically appends user or assistant messages with project epoch tracking, enforces conversation ownership (callers can only record into their own conversations), and updates conversation `updated_at`.
  - Database client connection handling fix in `@relay/database` `callMutation` to properly differentiate `pg.Pool` from `pg.PoolClient` and execute directly on the client during transactions without re-calling `.connect()`.
- **Contracts and Committed JSON Schemas (`packages/contracts`)**:
  - Zod schemas in `packages/contracts/src/ai.ts` and `handover.ts`: `AnswerInputSchema`, `AnswerOutputSchema`, `AnswerStatementSchema`, `AnswerLimitationSchema`, `PostMessageInputSchema`, `ConversationMessageSchema`, `ConversationSummarySchema`, and `ExportHandoverQuerySchema`.
  - Generated and committed 82 JSON Schemas in `packages/contracts/schemas/` via `npm run schemas:generate`.
- **Backend AI & Q&A Service (`apps/api/src/ai`, `apps/api/src/routes/conversations.ts`)**:
  - Versioned Q&A prompt template `qa-v1` in `apps/api/src/ai/prompts/index.ts`.
  - Semantic validator `validateAnswerOutput` in `apps/api/src/ai/validators/semantic-validator.ts`: enforces statement ceiling (max 12), verifies all citations reference supplied candidate claims, blocks citation leakage, and validates clarification prompt requirements.
  - Deterministic fake provider support in `FakeDeterministicProvider` for `generateAnswer`: rule-based matching over candidate claims, supporting answer generation, conflict detection (`conflicting_evidence`), and adversarial test modes (`unsupplied_claim`, `fabricated_claim_id`).
  - Full-text search over accessible claims using PostgreSQL `to_tsquery('english', ...)` with OR-disjunction and `ts_rank` ordering, limited to the top 40 candidates.
  - Zero-match short-circuit: questions with no keyword matches immediately return `insufficient_evidence` with 0 model calls.
  - Stale context and revocation detection: checks project access epoch before recording; returns generic `historyUnavailableNotice` for conversation history following epoch advancement or revocation.
  - Audit logging and AI usage tracking with `purpose: 'answer'` and valid outcome states.
- **Handover Export Service (`apps/api/src/export`, `apps/api/src/routes/handovers.ts`)**:
  - Markdown exporter (`apps/api/src/export/markdown.ts`): renders complete handover document with table of contents, item statuses, evidence states, claim citations, defangs HTML (`<script>`, `<iframe>`), and defangs markdown links from untrusted source content.
  - PDF exporter (`apps/api/src/export/pdf.ts`): renders professional handover PDF using PDFKit and bundled Unicode OFL fonts (`NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`); renders section hierarchy, items, evidence states, and citations without executing embedded scripts.
  - Export endpoint `GET /api/v1/handovers/:id/export?format=md|pdf`: enforces recipient and reviewer validity rules (Section 2A.9 item 2), requires `status: 'shared'` for recipients, verifies access epoch, blocks unapproved/stale handovers with 409 `REGENERATION_REQUIRED`, sets `Cache-Control: no-store`, sanitizes filenames, and logs audit events (`action: 'handover.export'`).
- **Web UI (`apps/web`)**:
  - Page `/app/projects/:projectId/ask` (`ProjectAskPage`): interactive evidence-grounded Q&A interface with conversation list, message history, and question submission.
  - Components `apps/web/src/components/qa/ChatPanel.tsx` and `AnswerStatement.tsx`: renders answered, insufficient evidence, and conflicting evidence states, expandable claim citations with quote previews and source titles, limitations, and clarification prompts; displays generic "history unavailable after an access change" notice when epoch changes.
  - Component `apps/web/src/components/handover/ExportMenu.tsx`: export dropdown on handover detail page with Markdown and PDF download handlers and error alerts.
  - Added "Ask Relay" navigation item to project sidebar (`apps/web/src/components/layout/Sidebar.tsx`).
  - Added `apiDownload` utility to `apps/web/src/lib/api.ts` for safe authenticated blob downloads.
- **Comprehensive Automated Tests**:
  - Unit tests (`tests/unit/qa-validator.test.ts`): 12 tests verifying semantic validation rules (statement limits, candidate claim citations, unknown citations, adversarial injection).
  - Integration tests (`tests/integration/qa-and-export.test.ts`): 11 tests verifying conversation creation, Q&A answers, FTS zero-match short-circuiting, unapproved export rejection (409), recipient export when shared, stale handover export rejection (409), and conversation pagination.
  - Security tests (`tests/security/qa-security.test.ts`): 14 tests verifying cross-tenant isolation, cross-project isolation, restricted claim leakage prevention in answers and citations, unsupplied claim semantic rejection (`422 SEMANTIC_VALIDATION_FAILED`), conflicting evidence preservation, epoch invalidation and history notice, immutability of core data during Q&A, HTML/script defanging in Markdown, PDF Unicode rendering with `pdftotext`, and 404 masking.
  - Playwright E2E tests (`tests/e2e/qa-export.spec.ts`): full browser workflow verifying recipient asking grounded question, receiving evidence citations, asking off-topic question and seeing `insufficient_evidence`, navigating to handover detail page, and exporting Markdown and PDF files.

## 2. Commands Run

- `npx supabase migration up`: PASSED (Applied migration `20261107100024_phase7_qa_and_conversations.sql` cleanly).
- `npm run schemas:generate`: PASSED (Committed JSON Schemas generated and verified in `packages/contracts/schemas`).
- `npm run format`: PASSED (Prettier formatting applied across all workspaces).
- `npm run format:check`: PASSED (All files verified clean with Prettier).
- `npm run typecheck`: PASSED (Root `tsc --build` compiled cleanly with 0 errors).
- `npm run lint`: PASSED (ESLint passed with 0 errors, 0 warnings across all workspaces).
- `npm run test`: PASSED (7 test files, 82 unit tests passed).
- `npm run test:integration`: PASSED (9 test files, 63 integration tests passed).
- `npm run test:security`: PASSED (12 test files, 79 security tests passed).
- `npm run test:e2e`: PASSED (All 7 Playwright E2E suites passed: 7 passed in 18.5s).
- `npm run build`: PASSED (Production web build generated; zero secrets bundled).
- `npm run demo:seed`: PASSED (Synthetic demo environment verified idempotently).

## 3. Exit Criteria

- **Unknown questions return insufficient evidence**: MET (Verified by `tests/integration/qa-and-export.test.ts` test "short-circuits when search returns zero matching claims without calling AI provider", `tests/security/qa-security.test.ts` test "short-circuits to insufficient_evidence with 0 model calls when search returns no matches", and `tests/e2e/qa-export.spec.ts` step 4: returns `insufficient_evidence` with empty statements, zero model calls, and explanatory limitations).
- **No restricted answers or citations**: MET (Verified by `tests/security/qa-security.test.ts` tests "excludes restricted claims from candidate claims for recipient questions" and "recipient Q&A never cites or leaks restricted claims in answers or citations": recipient answers never incorporate or reference claims derived from restricted sources).
- **No restricted exports**: MET (Verified by `tests/security/qa-security.test.ts` tests "outsider cannot export handover (returns 404)", "recipient cannot export unapproved draft (returns 409 REGENERATION_REQUIRED)", and "recipient export excludes restricted sources and claims": exports never disclose unshared handovers or restricted items).
- **Revocation and access changes invalidate content**: MET (Verified by `tests/security/qa-security.test.ts` test "stale conversation history returns generic notice after access epoch advances" and test "epoch change invalidates handover export for recipient (returns 409 REGENERATION_REQUIRED)": access epoch increments invalidate stale exports and redact previous conversation history with generic notice).
- **Model citing unsupplied claim is rejected**: MET (Verified by `tests/security/qa-security.test.ts` test "rejects model output that cites unsupplied claim ID (422 SEMANTIC_VALIDATION_FAILED)" and `tests/unit/qa-validator.test.ts`: semantic validator detects and rejects claims not provided in candidate batch).
- **Conflicts are preserved in answers**: MET (Verified by `tests/security/qa-security.test.ts` test "preserves conflicting evidence in answers with conflicting_evidence status": statements on controversial topics return `conflicting_evidence` status and link conflicting claims).
- **Q&A never mutates core data**: MET (Verified by `tests/security/qa-security.test.ts` test "running Q&A queries never alters claims, handovers, reviews, or project memberships": verified database table counts and hashes remain unchanged).
- **Hostile content defanged in exports and PDF verified with pdftotext**: MET (Verified by `tests/security/qa-security.test.ts` test "escapes HTML and defangs markdown links in Markdown export" and test "PDF export renders hostile and non-Latin content safely": verified via `pdftotext - -` that text renders inertly without execution).

## 4. Decisions and Spec Issues Recorded

- **Bundled Unicode Fonts for PDF**: Bundled Google Noto Sans (`NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`) with Open Font License (`OFL.txt`) inside `apps/api/assets/fonts/` for PDFKit export to avoid host system font dependencies.
- **FTS Query Construction**: Question keywords are tokenized, joined with ` | ` (OR) in `to_tsquery('english', ...)`, and ranked with `ts_rank` over accessible claims, balancing conversational matching with zero-match short-circuiting.
- **`ai_usage.purpose` Constraint**: Aligned with database check constraint `ai_usage_purpose_check` using `purpose: 'answer'` and `outcome: 'ok'`.
- **`callMutation` Pool vs Client**: Differentiated `pg.Pool` from `pg.PoolClient` so nested transaction operations do not call `.connect()` on active clients.
- **Hostile Payload Defanging**: HTML tags defanged and markdown links stripped of scheme in Markdown and PDF export render pipelines.
- **Recipient Access Rules**: Recipient access to handovers and exports requires `shared` status; unshared handovers return 409 `REGENERATION_REQUIRED` to recipients.
- Recorded in `docs/decisions.md` under Decisions and Spec Issues.

## 5. Known Limitations

- Real Gemini model generation requires `GEMINI_API_KEY`. Automated tests and demo runs utilize `FakeDeterministicProvider`, which deterministically creates evidence-backed answers and conflict resolutions from candidate claims.
- Hardening, WCAG accessibility auditing, CI pipelines, Docker containerization, and operations runbooks are implemented in Phase 8.
