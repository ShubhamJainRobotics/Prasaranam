# Phase Report: Hackathon Alignment Additions

## 1. Implemented

- **Handover Acknowledgement of Receipt (Hackathon Addition 1)**:
  - Database schema: Created migration `20261110100025_handover_acknowledgements.sql` adding `public.handover_acknowledgements` with composite foreign keys to `handovers(id)` and `project_members(project_id, user_id)`, unique constraint `(handover_id, user_id)`, RLS enabled, and `handover_acknowledgements_select` policy restricting visibility to the named recipient and project owners/reviewers who can read the handover. All direct `INSERT`, `UPDATE`, and `DELETE` grants revoked from `anon` and `authenticated`.
  - Mutation function: Created migration `20261110100026_acknowledge_handover_function.sql` defining `app_private.acknowledge_handover(actor_id, handover_id)` with `search_path = ''`, checking that the caller is the named recipient, status is `shared`, access epoch matches current project epoch, caller is an active project member, and all cited claims remain readable. It writes an audit event in the same transaction, returns existing rows idempotently without creating duplicates, and enforces service-role-only execution (`REVOKE ALL FROM public, anon, authenticated; GRANT EXECUTE TO service_role`).
  - API routes: Added `POST /api/v1/handovers/:id/acknowledge` with `requireAction('HANDOVER_ACKNOWLEDGE')`. Updated `GET /api/v1/handovers/:id` and `GET /api/v1/projects/:id/handovers` to query and return `acknowledgedAt` (timestamp string or `null`).
  - Web UI: Added an "I have read this handover" button in `apps/web/src/routes/HandoverDetailPage.tsx` for designated recipients that confirms receipt, disables upon acknowledgement, and displays the server-confirmed timestamp. Added an explicit text badge ("Acknowledged by recipient on <date>" / "Not yet acknowledged") on reviewer handover lists in `apps/web/src/routes/ProjectHandoversPage.tsx`.

- **Recurring Problems Read-Time Discovery (Hackathon Addition 2)**:
  - Dynamic discovery without AI storage: Added `GET /api/v1/projects/:id/recurring-problems` in `apps/api/src/routes/projects.ts` evaluating readable `blocker` and `risk` claims dynamically at request time using the all-evidence access rule (`app_private.can_read_claim`).
  - Deterministic clustering: Normalized statements (lowercased, stripped punctuation and common stop words) and computed Jaccard token similarity with a named threshold constant `RECURRING_PROBLEMS_JACCARD_THRESHOLD = 0.6`. Groups require evidence from at least two distinct sources and cap input claims at 200.
  - Zero restricted leakage: Inaccessible claims and sources are filtered out before grouping so caller access boundaries are strictly preserved.
  - Web UI: Added a "Recurring problems" tab in `apps/web/src/routes/ProjectKnowledgePage.tsx` with the disclaimer "Possible recurring problem, grouped by similar wording; please confirm" and clickable evidence drawer buttons opening source references.

- **Duplicate Import Detection (Hackathon Addition 3)**:
  - SHA-256 duplicate matching: Added SHA-256 duplicate check in `apps/api/src/routes/sources.ts` during document and pasted text ingestion against unarchived sources in the project readable by the caller (`app_private.can_read_source`). Rejects duplicates with `409 DUPLICATE_SOURCE` returning the existing source `id` and `title`, unless `allowDuplicate: true` is passed.
  - Lineage exemption: Re-imports with `replacesSourceId` (replace-by-revision) are exempt for their own lineage.
  - Oracle prevention: Duplicates of restricted sources that the caller cannot read are not detected or mentioned; the import proceeds normally with a 201 response so duplicate checks never reveal restricted source existence.
  - Web UI: Added duplicate conflict handling in `apps/web/src/components/sources/ImportWizard.tsx` with a warning banner showing "This content already exists as <title>" and "Cancel" and "Import anyway" buttons. Added `DUPLICATE_SOURCE` to `@relay/contracts` error codes and `docs/openapi.yaml`.

- **Product Rename to Prasaranam (Hackathon Addition 4)**:
  - User-visible rebranding: Renamed all user-facing occurrences of "Relay" across HTML title (`apps/web/index.html`), app header and topbar (`Topbar.tsx`), sidebar (`Sidebar.tsx`), landing page (`LandingPage.tsx`), auth pages (`LoginPage.tsx`, `RegisterPage.tsx`, `ResetPasswordPage.tsx`, `ForgotPasswordPage.tsx`), new handover and review pages, Markdown export templates (`markdown.ts`), PDF export headers (`pdf.ts`), OpenAPI specification title (`docs/openapi.yaml`), and `README.md`.
  - Architecture preservation: Kept internal npm package scopes (`@relay/*`), import specifiers, and directory paths unchanged to preserve backward compatibility.
  - Regression testing: Created `tests/unit/rename.test.ts` asserting zero occurrences of legacy user-facing brand strings in `apps/web/src`, export headers, and `README.md`.

- **AI-Use Disclosure (Hackathon Addition 5)**:
  - Comprehensive disclosure document: Created `docs/ai-disclosure.md` detailing AI assistance tools (Antigravity CLI and IDE) across all engineering phases, quoting logged models (`gemini-2.5-pro` where recorded; "model not recorded" elsewhere per instructions), human architectural oversight, and zero-placeholder guarantees.

- **Documentation & Scenario Alignment**:
  - Updated `docs/decisions.md` under "Additions beyond the spec" with rationale, dates, and architectural choices.
  - Added scenario steps to `scripts/run-scenarios.ts` (`scenario-2-importing.ts`, `scenario-4-knowledge-extraction.ts`, `scenario-6-handover-lifecycle.ts`).
  - Updated `docs/feature-inventory.md` via `npm run inventory` including new API routes.
  - Updated `docs/security-test-matrix.md` with Items 36–39 covering new negative security requirements.

## 2. Commands run

- `npm run db:reset`: **PASSED** (Recreated local PostgreSQL database and applied all 27 migrations cleanly).
- `npm run typecheck`: **PASSED** (`tsc --build` completed with 0 errors across all 6 workspaces).
- `npm run lint`: **PASSED** (`eslint .` reported 0 lint errors or warnings).
- `npm run format:check`: **PASSED** (`prettier --check .` reported all matched files use Prettier code style).
- `npm run test`: **PASSED** (9 test files, 87 unit tests passed).
- `npm run test:integration`: **PASSED** (12 test files, 82 integration tests passed, including acknowledgement, recurring problems, and duplicate import suites).
- `npm run test:security`: **PASSED** (15 test files, 96 negative security tests passed).
- `npm run test:e2e`: **PASSED** (15 Playwright browser tests passed in 1.4m).
- `npm run build`: **PASSED** (TypeScript builds for all packages and Vite production bundle build for web completed successfully).
- `npm run scan:bundle`: **PASSED** (Inspected 7 files in `apps/web/dist`, 0 secrets or sensitive keys detected).
- `npm run inventory`: **PASSED** (Regenerated `docs/feature-inventory.md` with new hackathon addition endpoints).
- `npm run openapi:lint`: **PASSED** (0 errors, 0 warnings in `docs/openapi.yaml`).

## 3. Exit criteria

- [x] **Handover acknowledgement of receipt implemented and verified end to end**: Proved by `tests/integration/acknowledgement.test.ts` (10 passing tests) and `tests/e2e/handover.spec.ts`.
- [x] **Recurring problems computed dynamically at read time with Jaccard grouping**: Proved by `tests/integration/recurring-problems.test.ts` (4 passing tests verifying grouping, source diversity, claim count cap, and restricted source exclusion).
- [x] **Duplicate import detection with SHA-256 and allowDuplicate override**: Proved by `tests/integration/duplicate-import.test.ts` (5 passing tests verifying 409 rejection, allowDuplicate override, silent import for unreadable duplicates, and lineage revision exemption).
- [x] **Product renamed to Prasaranam across all user-visible interfaces**: Proved by `tests/unit/rename.test.ts` (4 passing sentinel tests) and Playwright E2E suites.
- [x] **No restricted information revealed by any new feature**: Proved by negative integration tests verifying unreadable duplicates import silently without oracle leakage, and recurring problems never leak unreadable claims or counts.
- [x] **AI-use disclosure written without inventing details**: Proved by `docs/ai-disclosure.md` sourced from git log, decisions.md, and phase reports.
- [x] **All verification commands passed**: Proved by clean execution of `db:reset`, `typecheck`, `lint`, `format:check`, `test`, `test:integration`, `test:security`, `test:e2e`, `build`, and `scan:bundle`.
- [x] **Nothing mocked or weakened**: Zero security controls loosened, RLS enforced on all tables, mutations restricted to `service_role` via `app_private`.

## 4. Decisions and spec issues recorded

- Recorded in `docs/decisions.md` under "Additions beyond the spec (2026-11-10)":
  - **Handover acknowledgement of receipt**: Added `handover_acknowledgements` table, `app_private.acknowledge_handover` function, and `POST /handovers/:id/acknowledge` route to track recipient sign-off with audit logging.
  - **Dynamic recurring problems**: Selected read-time Jaccard token clustering (`threshold = 0.6`, 200 claim cap) over stored embeddings to guarantee zero data leakage and instantaneous access revocation.
  - **Duplicate source detection**: Added SHA-256 duplicate checking with `409 DUPLICATE_SOURCE` and `allowDuplicate` override, ensuring unreadable sources import silently without oracle vulnerability.
  - **Prasaranam branding**: Renamed all user-facing brand strings while preserving internal package scope `@relay/*` to avoid breaking monorepo imports.

## 5. Known limitations

- **Client-side Jaccard tokenization for English**: The recurring problems similarity algorithm uses English stop words and whitespace tokenization; non-Latin languages or unpunctuated scripts may experience lower cluster recall.
- **Single active recipient acknowledgement**: Acknowledgements attach to a specific version of a handover; generating and sharing a subsequent revision supersedes prior versions and requires a new acknowledgement from the recipient.
- **Scenario pack health check defect records**: Five pre-existing defect steps in `scripts/run-scenarios.ts` from Phase 10 remain marked as broken in `docs/scenario-report.json` as required by the scenario pack benchmark specification.
