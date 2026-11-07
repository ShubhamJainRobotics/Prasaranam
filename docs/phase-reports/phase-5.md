# Phase 5 Report: Jobs and AI Extraction

## 1. Implemented

- **Gemini SDK Verification & Adapters (`apps/api/src/ai`)**:
  - Inspected `@google/genai` (v3.0.0) SDK type definitions directly (`genai.d.ts`), verifying class initialization, `ai.models.list()`, `ai.models.generateContent()`, structured JSON schema fields, and token usage metadata. Recorded verified identifiers in `docs/decisions.md`.
  - Implemented `StructuredAiProvider` interface with two implementations: `GeminiProvider` (timeout, cancellation, defensive JSON parsing, Zod validation, bounded backoff with jitter for transient 429/503 errors, single repair prompt attempt without extra context, and metadata-only logging) and `FakeDeterministicProvider` (heuristic parser with exact quotes over chunk text; adversarial fixtures).
  - Ensured no tools or code-execution options are ever configured or passed to the Gemini SDK.
- **Versioned Prompts, Contracts, and Schemas**:
  - Authored versioned prompt templates (`extraction-v1`, `relationship-v1`, `clarification-v1`) under `apps/api/src/ai/prompts/`.
  - Shared contracts in `packages/contracts/src/ai.ts` for extraction inputs/outputs, relationship inputs/outputs, clarification inputs/outputs, job details, and AI token usage summaries.
  - Generated 14 new committed JSON Schemas in `packages/contracts/schemas/` (60 total in repository).
- **Semantic Validation Pipeline (`apps/api/src/ai/validators/semantic-validator.ts`)**:
  - Exact quote verification against chunk text with Unicode code-point offset matching using the first-match rule.
  - Strict provenance validation: citations must only reference chunk IDs present in the current extraction batch.
  - Evidence strength ceiling enforcement per Section 2A.5: inferred claims capped at `medium`, past events without direct evidence capped at `low`, direct quotes capped at `high`.
  - Temporal validation: `observedAt` cannot precede the source `event_at` or be in the future.
  - State validation: raw extraction cannot mark tasks completed or cancelled without explicit evidence.
  - Quarantine of unsupported or hallucinated claims.
- **Access-Class Batching (`apps/worker/src/handlers/extract.ts`)**:
  - Batches chunks strictly by access boundary (`public` vs restricted grant sets) up to `AI_MAX_INPUT_TOKENS` (8,000 tokens), preventing cross-access contamination.
- **Database Migrations and Persistence Functions (`supabase/migrations`)**:
  - `20261107100020_phase5_ai_persistence_and_mutations.sql`, `20261107100021_lease_job_requested_by.sql`, and `20261107100022_fix_flag_claim_project_id.sql`:
    - `app_private.persist_claims`: Transactionally validates access epoch, inserts claims with `dedupe_key` (`ON CONFLICT DO NOTHING`), attaches evidence links, and verifies database constraints.
    - `app_private.persist_relationships`: Records claim relationships (`contradicts`, `supersedes`, `depends_on`, `relates_to`).
    - `app_private.persist_questions`: Persists clarification questions deduplicated by `(project_id, question_text)`.
    - `app_private.record_ai_usage`: Persists token consumption and request duration in `public.ai_usage`.
    - Mutation functions: `review_claim`, `set_claim_owner`, `flag_claim`, `dismiss_question`, `retry_job`.
    - Typed database wrappers in `packages/database/src/index.ts`.
- **Background Worker Engine (`apps/worker`)**:
  - Atomic leasing loop using `app_private.lease_job` (`FOR UPDATE SKIP LOCKED`).
  - Active lease heartbeat loop (10s intervals) with `lock_token` renewal and automatic expiry requeue via `app_private.requeue_expired_jobs`.
  - In-flight cancellation polling via `app_private.request_cancel_job`.
  - Token quota checks per project and user per Section 2A.12.
  - Handlers for `extract`, `analyze_relationships`, and `generate_questions`.
  - Structured metadata-only logging via Pino (zero raw source text or prompt data logged).
- **Backend API Routes (`apps/api/src/routes`)**:
  - Jobs & Extractions: `POST /api/v1/projects/:id/extractions`, `GET /api/v1/jobs/:id`, `POST /api/v1/jobs/:id/cancel`, `POST /api/v1/jobs/:id/retry`.
  - Claims: `GET /api/v1/projects/:id/claims`, `GET /api/v1/claims/:id`, `PATCH /api/v1/claims/:id/review`, `PATCH /api/v1/claims/:id/owner`, `POST /api/v1/claims/:id/flags`.
  - Conflicts & Timeline: `GET /api/v1/projects/:id/conflicts`, `GET /api/v1/projects/:id/timeline`.
  - Clarification Questions: `POST /api/v1/projects/:id/questions/generate`, `GET /api/v1/projects/:id/questions`, `POST /api/v1/questions/:id/dismiss`, `POST /api/v1/questions/:id/answer`.
- **Web UI (`apps/web`)**:
  - Routes: `/app/projects/:projectId/knowledge` (`ProjectKnowledgePage`) and `/app/projects/:projectId/questions` (`ProjectQuestionsPage`).
  - Components: `ClaimCard`, `ClaimDetailPanel`, `EvidenceDrawer`, `EvidenceCitation`, `EvidenceStateBadge`, `TaskStateBadge`, `ReviewStateBadge`, `KnowledgeFilters`, `ConflictPanel`, `DecisionTimeline`, `DependencyList`, `ClaimFlagDialog`, `OwnerLinkDialog`, `JobProgressPanel`, `ClarificationQuestionCard`, `ClarificationAnswerDialog`, `DemoModeBanner`.
  - Secure rendering: all extracted text and quotations are escaped as plain text; zero unescaped HTML injection.
- **Automated Tests**:
  - Unit tests for provider adapters and semantic validators with adversarial fixtures.
  - Integration tests for end-to-end extraction, relationships analysis, and worker execution.
  - Security tests for epoch invalidation, cross-tenant isolation, restricted claim leakage, and non-authenticating requests.
  - Playwright E2E test verifying browser extraction, claim inspection, evidence drawer display, and question answering.

## 2. Commands Run

- `npx supabase migration up`: PASSED (Applied migrations `20261107100020`, `20261107100021`, `20261107100022` to local Supabase).
- `npm run schemas:generate`: PASSED (Generated 60 JSON Schemas in `packages/contracts/schemas`).
- `npm run format`: PASSED (Formatted 42 modified files with Prettier).
- `npm run format:check`: PASSED (All files verified clean with Prettier).
- `npm run typecheck`: PASSED (Root `tsc --build` compiled all workspaces cleanly with 0 errors).
- `npm run lint`: PASSED (0 errors, 0 warnings across all workspaces).
- `npm run test`: PASSED (5 test suites, 60 unit tests passed).
- `npm run test:integration`: PASSED (7 test suites, 51 integration tests passed).
- `npm run test:security`: PASSED (10 test suites, 60 security tests passed).
- `npm run test:e2e`: PASSED (4 test suites, 5 browser tests passed).
- `npm run build`: PASSED (All workspaces built cleanly; production web bundle generated with no secrets).
- `npm run verify:env`: PASSED (Environment variables and AI capabilities verified).
- `npm run demo:seed`: PASSED (Synthetic demo environment created and verified idempotently).

## 3. Exit Criteria

- **Restarts do not duplicate claims**: MET (`tests/integration/ai-pipeline.test.ts` proves that retrying a completed or failed extraction job, or reprocessing identical chunks, executes `persist_claims` with `dedupe_key` collision handling and produces no duplicate claims; `tests/integration/ai-pipeline.test.ts` also proves idempotency conflict handling when different payloads reuse an idempotency key).
- **Invalid AI output rejected**: MET (`tests/unit/semantic-validator.test.ts` and `tests/security/ai-security.test.ts` verify that fabricated chunk IDs, altered quotes, invalid code-point offsets, future `observedAt` timestamps, illegal work states, and out-of-scope cross-project claim references are rejected by the semantic validator and trigger security).
- **Revocation blocks stale persistence**: MET (`tests/security/ai-security.test.ts` confirms that when source access is modified or member permissions are revoked during an in-flight job, the project access epoch increments and `app_private.persist_claims` rejects persistence with `STALE_ACCESS_EPOCH`).

## 4. Decisions and Spec Issues Recorded

- **Gemini SDK Inspection**: Inspected `node_modules/@google/genai/dist/genai.d.ts` (v3.0.0). Verified method `ai.models.generateContent({ model, contents, config })`, model listing `ai.models.list()`, response schema config fields (`responseMimeType`, `responseSchema`/`responseJsonSchema`), and token usage metadata (`response.usageMetadata.promptTokenCount`, `candidatesTokenCount`). Recorded in `docs/decisions.md`.
- **Worker Job Attributions**: `public.ai_usage` requires `user_id uuid not null`. Added `requested_by` to the return values of `app_private.lease_job` so token consumption is directly attributed to the user who enqueued the job.
- **Claim Flag Foreign Key**: `public.claim_flags` requires `project_id uuid not null` as part of composite foreign key `(claim_id, project_id)`. Populated `project_id` in `app_private.flag_claim`.
- **Idempotency Conflict Code Mapping**: `app_private.enqueue_job` raises `'IDEMPOTENCY_CONFLICT'` on payload mismatch; route handles both `'IDEMPOTENCY_CONFLICT'` and `'IDEMPOTENCY_PAYLOAD_MISMATCH'` to return HTTP 422.
- Recorded in `docs/decisions.md` under Decisions and Spec Issues.

## 5. Known Limitations

- When `GEMINI_API_KEY` is not set or `DEMO_MODE=true` is enabled, the worker and tests run using the deterministic fake AI provider (`fake-deterministic`).
- The fake AI provider operates heuristically via keyword and punctuation regex over chunk sentences, accurately finding decisions, proposals, tasks, blockers, risks, responsibilities, and contradictions with exact source quotes, but does not perform neural inference.
- Handover draft generation, review workflow, and PDF/Markdown exports are implemented in subsequent phases (Phase 6 and 7).
