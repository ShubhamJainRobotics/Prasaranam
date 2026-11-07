# Phase 6 Report: Handover Workflow

## 1. Implemented

- **Database Migrations and Transactional Functions (`supabase/migrations/20261107100023_phase6_handover_workflow.sql`)**:
  - `app_private.create_handover_draft_from_generation`: Transactionally locks project row, verifies caller and recipient memberships, re-validates current access epoch, enforces dual-reader claim accessibility (`app_private.can_read_claim(claim_id, reviewer_id) AND app_private.can_read_claim(claim_id, recipient_id)`), derives item evidence states, persists items and citations, and logs audit events. Fails with retryable stale context error on epoch mismatch.
  - `app_private.update_item`: Optimistic concurrency control via `row_version` (enforcing `If-Match` header in API), allows editing text, setting review state (`approved`, `rejected`), downgrading evidence state, and logging review actions. Enforces facts and suggestions must retain at least one supporting claim.
  - `app_private.add_item_from_claims`: Allows reviewers to add custom items to draft handovers, validating that all cited claims are accessible to both reviewer and recipient.
  - `app_private.attach_claims`: Attaches additional claims to existing items, verifying dual-reader permissions and optimistic locking.
  - `app_private.flag_item`: Downgrades item evidence state (downgrade only, never upgrade) and logs reviewer comments.
  - `app_private.add_reviewer_context`: Imports a reviewer context note as a source using `app_private.import_source` and enqueues an extraction job.
  - `app_private.create_revision`: Clones an approved or shared handover into a new draft with incremented version number under the same `root_id`.
  - `app_private.approve_handover`: Enforces review preconditions (status is `draft`, 0 items pending, at least 1 approved item, `confirm_reviewed_for_recipient = true`, epoch matches). Enters immutable approved state and logs review history.
  - `app_private.share_handover`: Validates handover is approved, marks older shared versions of the same root as `superseded`, sets status to `shared`, and publishes for recipient access.
  - **Database Immutability Triggers**:
    - `handovers_immutability`: Blocks SQL `UPDATE` and `DELETE` on handovers in `approved` or `shared` status.
    - `handover_items_immutability`: Blocks SQL `INSERT`, `UPDATE`, and `DELETE` on items belonging to approved or shared handovers.
  - Typed mutation wrappers added to `packages/database/src/index.ts`.
- **Contracts, Prompts, and Semantic Validation (`packages/contracts`, `apps/api/src/ai`)**:
  - Handover contracts in `packages/contracts/src/handover.ts`: schemas for creation, update, approval, sharing, revision, reviewer context, and item claim citations. Committed JSON Schemas generated via `npm run schemas:generate`.
  - Versioned prompt template `handover-v1` in `apps/api/src/ai/prompts/index.ts`.
  - Semantic validator `validateHandoverOutput` in `apps/api/src/ai/validators/semantic-validator.ts`: ensures facts cite evidence-bearing claims, suggestions cite motivating claims, unknown items assert no facts, claims belong to the candidate batch, item limits are respected, and evidence states are conservatively derived per Section 2A.5.
  - Deterministic fake provider support in `FakeDeterministicProvider` generating structured handovers based on candidate claims without neural dependencies.
- **Worker Handler (`apps/worker/src/handlers/handover.ts`)**:
  - Leased job handler for `generate_handover`: locks access epoch, filters candidate claims readable by both reviewer and recipient, applies handover configuration (detail level, section selection, date ranges, completed work toggles), invokes provider, executes semantic validation, and persists draft transactionally.
- **Backend API Routes (`apps/api/src/routes/handovers.ts`)**:
  - `POST /api/v1/projects/:id/handovers`: Enqueues handover generation with `Idempotency-Key` requirement and caller quota checks.
  - `GET /api/v1/projects/:id/handovers`: Lists handovers with cursor pagination and role-filtered visibility.
  - `GET /api/v1/handovers/:id`: Returns handover details, items with citations, and review progress. Implements Section 2A.9 validity rules: active items for authorised readers, 409 `REGENERATION_REQUIRED` for recipients when access epoch changes or claims are revoked, and metadata-only (`items: []`, `isStale: true`) for reviewers on stale drafts. Outsiders receive 404 `NOT_FOUND`.
  - `PATCH /api/v1/handovers/:id/items/:itemId`: Optimistic concurrency updates with `If-Match: "<rowVersion>"`.
  - `POST /api/v1/handovers/:id/items`: Adds reviewer-authored items with dual-reader claim validation.
  - `POST /api/v1/handovers/:id/context`: Imports reviewer context notes and triggers extraction.
  - `POST /api/v1/handovers/:id/versions`: Creates revisions of approved or shared handovers.
  - `POST /api/v1/handovers/:id/approve`: Validates attestation and zero pending items, locking the version.
  - `POST /api/v1/handovers/:id/share`: Shares approved handover with recipient and supersedes prior versions.
  - `GET /api/v1/handovers/:id/reviews`: Returns full audit trail of review actions.
- **Web UI (`apps/web`)**:
  - Routes: `/app/projects/:projectId/handovers` (`ProjectHandoversPage`), `/app/projects/:projectId/handovers/new` (`NewHandoverPage`), `/app/handovers/:handoverId/review` (`HandoverReviewPage`), and `/app/handovers/:handoverId` (`HandoverDetailPage`).
  - Components: `HandoverConfigurationForm`, `HandoverVersionSelector`, `HandoverSection`, `HandoverItem`, `HandoverReviewToolbar`, `ReviewerAttestation`, `ApprovalDialog`, `ShareDialog`, `StaleHandoverNotice`, `ReviewCommentPanel`, `RecipientPreview`.
  - Navigation links added to Project Sidebar (`Handovers`).
- **Comprehensive Automated Tests**:
  - Unit tests (`tests/unit/handover-validator.test.ts`): validates semantic validation rules, attestation handling, quote linking, and invalid output rejection.
  - Integration tests (`tests/integration/handover-workflow.test.ts`): end-to-end lifecycle test covering creation, item review, optimistic concurrency (`If-Match`), revision creation, approval, sharing, and superseding.
  - Security tests (`tests/security/handover-security.test.ts`): verifies dual-reader claim scoping, rejection of restricted claim attachment, trigger-level immutability against direct SQL mutation, epoch invalidation with 409 `REGENERATION_REQUIRED`, and 404 masking for outsiders.
  - Playwright E2E (`tests/e2e/handover.spec.ts`): complete browser workflow verifying reviewer draft generation, item approval, attestation confirmation, sharing, recipient viewing, and leak isolation (restricted compensation notes never appear).

## 2. Commands Run

- `npx supabase migration up`: PASSED (Applied migration `20261107100023_phase6_handover_workflow.sql` cleanly).
- `npm run schemas:generate`: PASSED (Committed JSON Schemas generated and verified in `packages/contracts/schemas`).
- `npm run format`: PASSED (Prettier formatting applied across all workspaces).
- `npm run format:check`: PASSED (All files verified clean with Prettier).
- `npm run typecheck`: PASSED (Root `tsc --build` compiled cleanly with 0 errors).
- `npm run lint`: PASSED (ESLint passed with 0 errors, 0 warnings across all workspaces).
- `npm run test`: PASSED (6 test suites, 70 unit tests passed).
- `npm run test:integration`: PASSED (8 test suites, 52 integration tests passed).
- `npm run test:security`: PASSED (11 test suites, 65 security tests passed).
- `npx playwright test tests/e2e/handover.spec.ts`: PASSED (Handover review, approval, sharing, and security flow passed in 6.4s).
- `npx playwright test`: PASSED (All 6 Playwright E2E suites passed: 6 passed in 17.7s).
- `npm run build`: PASSED (Production web build generated; zero secrets bundled).
- `npm run demo:seed`: PASSED (Synthetic demo environment verified idempotently).

## 3. Exit Criteria

- **No unreviewed sharing**: MET (Verified by `tests/integration/handover-workflow.test.ts`, `tests/security/handover-security.test.ts`, and `tests/e2e/handover.spec.ts`: attempting to share a draft returns HTTP 409 `PRECONDITION_FAILED`; attempting to approve a draft with pending items returns HTTP 409 `PRECONDITION_FAILED`; approval requires explicit `confirmReviewedForRecipient = true` else returns HTTP 422 `VALIDATION_ERROR`; at least 1 approved item is mandatory; facts and suggestions must retain evidence links).
- **Immutable approved versions**: MET (Verified by `tests/security/handover-security.test.ts`: database triggers `handovers_immutability` and `handover_items_immutability` reject direct SQL `UPDATE`, `DELETE`, and item `INSERT`/`UPDATE`/`DELETE` on approved or shared handovers even under `service_role`).
- **Valid recipient-only shared access**: MET (Verified by `tests/security/handover-security.test.ts` and `tests/e2e/handover.spec.ts`: dual-reader filtering excludes restricted sources from recipient handovers; project access epoch changes return HTTP 409 `REGENERATION_REQUIRED` to recipient; sharing supersedes prior versions; unauthorized callers receive uniform HTTP 404 `NOT_FOUND`).

## 4. Decisions and Spec Issues Recorded

- **Dual-Reader Claim Scoping**: Claims are filtered with `app_private.can_read_claim(c.id, reviewer_id) AND app_private.can_read_claim(c.id, recipient_id)` during generation, and revalidated atomically inside the persistence transaction.
- **Review Precondition Status Mapping**: In `app_private.approve_handover`, pending items raise `PRECONDITION_FAILED` (HTTP 409), whereas missing reviewer attestation confirmation raises `VALIDATION_ERROR` (HTTP 422).
- **Trigger-Level Immutability**: Direct mutations to approved or shared handovers and items are rejected at PostgreSQL trigger layer.
- **Shared Version Superseding**: Sharing a new revision atomically marks previous shared versions of the same root as `superseded` and audits the transition.
- **Stale Handover Invalidation**: Epoch mismatch returns 409 `REGENERATION_REQUIRED` for recipients, and strips items (`items: []`, `isStale: true`) for reviewers.
- Recorded in `docs/decisions.md` under Decisions and Spec Issues.

## 5. Known Limitations

- Real Gemini model generation requires `GEMINI_API_KEY`. Automated tests and demo runs utilize `FakeDeterministicProvider`, which deterministically creates evidence-backed handovers from extracted claims.
- Q&A over project knowledge and PDF/Markdown file export workflows are implemented in Phase 7.
