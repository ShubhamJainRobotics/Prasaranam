# AI-Use Disclosure

This document discloses the use of artificial intelligence tools and assistants during the design, implementation, and testing of the Prasaranam (formerly Relay) knowledge handover platform, in accordance with hackathon submission guidelines.

---

## 1. Tools and Environments Used

- **Primary Development Tools**: Google Antigravity CLI and Antigravity IDE.
- **Underlying AI Models**:
  - Components implemented across Phases 0 through 9: **model not recorded** (no specific model version identifier is recorded in `docs/decisions.md` or the historical phase reports `docs/phase-reports/phase-*.md`).
  - Automated application testing and local demo execution: The platform includes and runs against a deterministic test provider (`FakeDeterministicProvider`), as mandated by SPEC Section 2A.12 for environments without live API credentials.

---

## 2. Components Built with AI Assistance

The following system components were implemented, refined, or verified using AI assistance via the Antigravity development environment:

### Phase 0: Environment Preflight & Configuration

- Host environment audits (Node.js, npm, Docker, Supabase CLI).
- Preflight configuration verification and initial ADR documentation.
- **Model**: model not recorded.

### Phase 1: Architecture & Monorepo Foundation

- Monorepo workspace orchestration (`apps/api`, `apps/web`, `apps/worker`, `packages/contracts`, `packages/database`, `packages/test-fixtures`).
- Shared TypeScript configuration and strict typing setup.
- Express.js API foundation with Helmet, CORS allowlisting, structured Pino logging, and rate limiting.
- React/Vite single-page application foundation with Tailwind CSS and TanStack Query.
- Health probe endpoints (`/health/live`, `/health/ready`).
- **Model**: model not recorded.

### Phase 2: Database Schema & Access Isolation

- Versioned Supabase PostgreSQL migrations (`20261107100001` through `20261107100017`).
- Two-layer data isolation: table privilege revocations (`anon`/`authenticated`) and row-level security (RLS) policies on every table.
- `app_private` SQL helper functions for permission calculation (`can_read_source`, `can_read_claim`, `can_read_handover`).
- Transactional mutation functions executable exclusively by `service_role`.
- Access-epoch invalidation triggers for membership, grant, and source changes.
- Last-owner database protection triggers.
- **Model**: model not recorded.

### Phase 3: Authentication & Workspace Interface

- Supabase Auth lifecycle (registration, login, password reset, session management).
- Workspace layout components (AppShell, Sidebar, Topbar, Breadcrumbs, Dialogs).
- Multi-tenant organisation and project administration interfaces.
- Non-enumerating member invitation flows.
- **Model**: model not recorded.

### Phase 4: Source Ingestion & Evidence Grounding

- Ingestion pipeline for UTF-8 plain text, Markdown, and structured JSON envelopes (`relay.messages.v1`, `relay.issues.v1`).
- Canonical text rendering and SHA-256 content hashing.
- Code-point-aware Unicode chunker adhering to SPEC Section 2A.6.
- Source viewer component with exact quote highlighting and evidence inspection drawer.
- **Model**: model not recorded.

### Phase 5: Job Queue & AI Extraction Pipeline

- PostgreSQL-backed atomic job queue with `FOR UPDATE SKIP LOCKED` leasing, heartbeats, and retry jitter.
- Gemini provider adapter using `@google/genai` (v3.0.0) SDK.
- Deterministic fake provider adapter (`fake-deterministic`) for reproducible testing.
- AI prompt templates and strict Zod validation schemas for claim extraction, relationship analysis, and clarification questions.
- Semantic validators enforcing quotation exactness, batch containment, and evidence ceiling rules.
- **Model**: model not recorded.

### Phase 6: Handover Synthesis & Review Studio

- Recipient-scoped handover draft generation constrained to mutually accessible claims.
- Human review studio (`/app/handovers/:id/review`): item approval, rejection, and inline editing.
- Reviewer-context ingestion and access grant enforcement.
- Reviewer attestation recording (`confirmReviewedForRecipient`).
- Handover immutability triggers for approved and shared versions.
- **Model**: model not recorded.

### Phase 7: Grounded Q&A & Document Export

- Full-text search (Postgres GIN index) claim retrieval filtered by caller access.
- Citation-grounded answering with zero-match short-circuiting to `insufficient_evidence`.
- Conversation epoch invalidation and access-change history hiding.
- HTML-defanged Markdown export and structured PDF export using PDFKit with bundled Unicode Google Noto Sans fonts.
- **Model**: model not recorded.

### Phase 8: Hardening & Compliance

- WCAG 2.1 AA accessibility audit, keyboard focus traps, and non-colour status badges.
- Production bundle security scanner (`scripts/scan-bundle.ts`) verifying no leaked server keys.
- Comprehensive security documentation: threat model (STRIDE), security architecture, and operational runbooks.
- **Model**: model not recorded.

### Phase 9: Verification & Scenario Execution

- Scenario execution suite (`scripts/run-scenarios.ts`) exercising full multi-role end-to-end user journeys.
- 35 automated negative security tests implementing Section 22.3 verification matrix.
- Verification and audit report (`docs/verification-report.md`).
- **Model**: model not recorded.

### Hackathon Additions (Post-Phase 9)

- Handover receipt acknowledgement table, SQL mutation, API route, and UI confirmation components.
- Deterministic read-time recurring problem grouping via Jaccard token similarity over accessible blocker and risk claims.
- SHA-256 duplicate source detection at import time with permission-aware silent imports and override capabilities.
- Complete product rename to Prasaranam across all user-facing touchpoints.
- **Model**: model not recorded.

---

## 3. Human Review & Verification Invariant

All application code, database migrations, security policies, and documentation produced with AI assistance were reviewed, compiled, and verified through automated test suites in accordance with Standing Rules 2, 3, and 7:

- No security check, test assertion, or isolation rule was loosened or skipped.
- All database mutations remain restricted to `app_private` functions callable only by `service_role`.
- No server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`) appear in client code, bundles, or logs.
