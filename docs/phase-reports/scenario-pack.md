# Phase Report: Scenario Pack and Feature Health Check

## 1. Implemented

- **Feature Inventory Tool (`scripts/feature-inventory.ts`, `docs/feature-inventory.md`)**:
  - Dynamically introspects registered Express route endpoints in `apps/api` and client route paths in `apps/web/src/router.tsx`.
  - Audits registered endpoints against all routes specified in SPEC Section 12 and Section 6.
  - Generates `docs/feature-inventory.md` marking each route as "implemented" or "not built" (51/52 API routes and 23/24 Web routes implemented; `GET /api/v1/projects/:id/audit` and `/app/projects/:projectId/audit` identified as unbuilt).
  - Registered as `npm run inventory` in `package.json`.
- **Synthetic Scenario Suite (`packages/test-fixtures/scenarios/`)**:
  - Engineered 9 distinct, fully isolated scenario runners with 94 total granular steps exercising every feature through the real API with real JWT tokens:
    - **Scenario 1 (`scenario-1-onboarding.ts`)**: 12 steps covering org creation, project creation, role assignments, email invites, and last-owner protection.
    - **Scenario 2 (`scenario-2-importing.ts`)**: 15 steps covering source uploads (Markdown, JSON chat, text, PDF, code), chunking, content deduplication, replace-by-revision, and archival.
    - **Scenario 3 (`scenario-3-access-control.ts`)**: 11 steps verifying tenant isolation across orgs, contributor source visibility, role boundary enforcement, and cross-project boundaries.
    - **Scenario 4 (`scenario-4-knowledge-extraction.ts`)**: 12 steps exercising worker extraction, chunk-to-claim linking, relationship analysis, question generation, idempotency deduplication, and quota handling.
    - **Scenario 5 (`scenario-5-clarification.ts`)**: 8 steps covering question dispatch, answer drafting, reviewer context injection, claim assignment, and claim review states.
    - **Scenario 6 (`scenario-6-handover-lifecycle.ts`)**: 13 steps validating handover generation, section constraints, derived evidence validation, item editing, reviewer sign-off attestation, approval, recipient sharing, and immutability.
    - **Scenario 7 (`scenario-7-questions-export.ts`)**: 9 steps validating conversational Q&A, FTS keyword search, model short-circuiting on insufficient evidence, citations, Markdown export defanging, and PDF export generation.
    - **Scenario 8 (`scenario-8-revocation-staleness.ts`)**: 9 steps testing source access restriction, project access epoch advancement, draft handover invalidation, stale-context retries, and conversation epoch staleness.
    - **Scenario 9 (`scenario-9-hardening.ts`)**: 5 steps testing payload size enforcement, burst rate limiting, audit event immutability, prompt injection resilience, and secret sanitization in logs.
  - Strict production safeguard in `packages/test-fixtures/scenarios/context.ts` aborting execution if `NODE_ENV === 'production'` or database host is non-local.
  - Zero-placeholder implementations: all requests use real Supabase Auth sessions, typed payloads, and real Mailpit email verification.
- **Scenario Runner CLI (`scripts/run-scenarios.ts`)**:
  - Implemented multi-mode CLI supporting `--run`, `--seed-only`, and `--reset-only`, exposed via `npm run scenarios:run`, `npm run scenarios:seed`, and `npm run scenarios:reset`.
  - Produces structured output artifacts `docs/scenario-report.md` and `docs/scenario-report.json`.
  - Exits with non-zero code (code 1) when any step for a built feature fails, while gracefully skipping steps targeting unbuilt routes according to the feature inventory.
- **End-to-End Browser Verification (`tests/e2e/scenarios/ui-flows.spec.ts`)**:
  - Authored a Playwright visual flow suite executing real user journeys across the web application.
  - Spawns and manages an in-process `RelayWorker` instance during test execution to process extraction and handover background jobs.
  - Captured 11 visual screenshots in `test-results/scenario-screenshots/`:
    `01-register.png`, `02-login.png`, `03-org-project.png`, `04-members.png`, `05-import-sources.png`, `06-chunk-viewer.png`, `07-knowledge-page.png`, `08-questions-page.png`, `09-handover-review.png`, `10-recipient-handover.png`, `11-qa-page.png`.
- **Manual Walkthrough Guide (`docs/manual-walkthrough.md`)**:
  - Authored step-by-step browser instructions for human verification of all 9 scenarios.
  - Instructions use real UI paths, form fields, and seeded credentials generated dynamically by `npm run scenarios:seed`.
- **Health Check & Defect Diagnosis**:
  - Diagnosed 5 concrete application defects without modifying application behavior, detailing expected vs actual status codes, request payloads, and root cause files in `docs/decisions.md` and `docs/scenario-report.md`.

## 2. Commands run

- `npm run inventory`: **PASSED** (exit code 0; built `docs/feature-inventory.md` with 51/52 API routes and 23/24 web routes verified).
- `npm run scenarios:seed`: **PASSED** (exit code 0; seeded self-contained test environment for manual walkthrough).
- `npm run scenarios:reset`: **PASSED** (exit code 0; cleanly purged all `scn-*` organisations, projects, and `@example.test` users).
- `npx playwright test tests/e2e/scenarios/ui-flows.spec.ts`: **PASSED** (exit code 0; 11 full-page visual screenshots generated in `test-results/scenario-screenshots/`).
- `npm run typecheck`: **PASSED** (exit code 0; `tsc --build` completed with 0 errors).
- `npm run lint`: **PASSED** (exit code 0; ESLint clean across all workspaces).
- `npm run test`: **PASSED** (exit code 0; 8 test files, 83 unit tests passed).
- `npm run scenarios:run`: **FAILED** (exit code 1 as required by criterion 3; 88 passed, 5 broken, 1 unbuilt route skipped; generated `docs/scenario-report.md` and `docs/scenario-report.json`).

## 3. Exit criteria

- 1. `npm run inventory` builds `docs/feature-inventory.md` from the registered Express and web routes; every route in Sections 12 and 6 is accounted for: **MET** (verified by `npm run inventory`).
- 2. `npm run scenarios:seed` creates realistic, self-contained data for all 9 scenarios without modifying production databases: **MET** (verified by `npm run scenarios:seed`).
- 3. `npm run scenarios:run` executes all 9 scenarios, generates `docs/scenario-report.md` and `docs/scenario-report.json`, and exits non-zero if any step for a built feature is broken: **MET** (verified by `npm run scenarios:run`, generated `docs/scenario-report.md` and `docs/scenario-report.json`, exited with code 1 due to 5 broken steps).
- 4. `npm run scenarios:reset` removes all `scn-` prefixed data, leaving the database in a clean state: **MET** (verified by `npm run scenarios:reset`).
- 5. All 9 visual flows have screenshots in `test-results/scenario-screenshots/`: **MET** (verified; 11 screenshots saved to `test-results/scenario-screenshots/`).
- 6. `docs/manual-walkthrough.md` allows a human tester to step through every flow in a browser without referencing the code: **MET** (verified; `docs/manual-walkthrough.md` written with self-contained browser instructions).
- 7. `npm run typecheck`, `npm run lint`, and `npm run test` pass: **MET** (all three commands passed with exit code 0).
- 8. `docs/decisions.md` is updated with any decisions or spec issues discovered: **MET** (updated with scenario pack isolation decisions and all 5 defect diagnoses).
- 9. Phase report in `docs/phase-reports/scenario-pack.md` in the required structure: **MET** (authored in `docs/phase-reports/scenario-pack.md`).

## 4. Decisions and spec issues recorded

- Recorded in `docs/decisions.md`:
  - **Scenario Rate Limiting Isolation**: To prevent rate limit test suites from depleting client IP budgets across scenarios, burst rate limit tests in Scenario 9 instantiate an ephemeral application with `RATE_LIMIT_MAX_REQUESTS: 5`, leaving the shared test instance with an ample quota of 2,000 requests.
  - **Scenario Reset Foreign Key Cascading Order**: In `resetScenarioData()`, handovers with status `approved` or `shared` are first demoted to `status = 'draft'` to prevent immutability database triggers from blocking deletes, followed by explicit child-to-parent deletion of `public.reviews`, `public.handover_item_claims`, `public.handover_items`, and `public.handovers` before deleting projects.
  - **Background Worker in Playwright E2E**: Playwright launches the API and Web Vite servers, but does not start the background worker. `tests/e2e/scenarios/ui-flows.spec.ts` starts an in-process `RelayWorker` connected to the test database and fake deterministic AI provider during `test.beforeAll` and stops it during `test.afterAll`.
  - **Defect 1: Demoting Last Project Owner (SPEC Section 11.1 / Section 12)**: `PATCH /api/v1/projects/:id/members/:userId` allows deactivating/demoting the sole active owner in a project, returning HTTP 200 instead of HTTP 409 `LAST_OWNER`.
  - **Defect 2: Demoting Last Organisation Owner Status Code (SPEC Section 11.1 / Section 12)**: `PATCH /api/v1/organisations/:id/members/:userId` returns HTTP 403 `FORBIDDEN` rather than HTTP 409 `LAST_OWNER` when attempting to demote the sole organization owner.
  - **Defect 3: Project Member Invitation User Enumeration (SPEC Section 18.1)**: `POST /api/v1/projects/:id/members` returns HTTP 404 `NOT_FOUND` when inviting an unknown email address rather than a non-enumerating generic success response (HTTP 200/201), allowing user enumeration.
  - **Defect 4: Tenant Isolation: Organisation Admin Project Access (SPEC Section 2A.2)**: `GET /api/v1/projects/:id` returns HTTP 200 to organization admins who are not project members, violating SPEC Section 2A.2 ("Organisation admins have no automatic access to project data...").
  - **Defect 5: Shared Handover Immutability Error Code (SPEC Section 2A.4 Item 8)**: The database trigger `enforce_handover_immutability()` correctly prevents updates on shared handovers, but raises a plpgsql exception that `apps/api/src/routes/handovers.ts` fails to catch, resulting in HTTP 500 (`P0001: An internal server error occurred`) rather than HTTP 409 `HANDOVER_IMMUTABLE` / `ILLEGAL_STATE`.
  - **Unbuilt Feature Route**: Identified `GET /api/v1/projects/:id/audit` and `/app/projects/:projectId/audit` as not built yet.

## 5. Known limitations

- **Application Defects Unpatched by Design**: In strict adherence to the phase instructions ("This phase adds test tooling and test data only. Do not change application behaviour and do not fix defects in this task; only report them"), none of the 5 discovered application defects were patched.
- **Unbuilt Audit Trail Feature**: Audit trail routes (`GET /api/v1/projects/:id/audit` and `/app/projects/:projectId/audit`) remain unbuilt per the feature inventory; scenario steps exercising this feature are skipped by the runner.
- **Email Verification Requires Local Mailpit**: Synthetic user verification relies on Mailpit API running locally on port 54324; external email infrastructure is intentionally not used.
