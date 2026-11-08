# Relay

> Evidence-Grounded, Permission-Aware Knowledge Handover Platform

Relay converts scattered, authorised project activity into evidence-backed, human-reviewed, recipient-specific knowledge handovers. Built with cryptographic provenance, strict multi-tenant isolation, access-epoch invalidation, and automated AI assistance powered by Google Gemini and deterministic fake adapters.

---

## 1. Prerequisites

Before running Relay locally or in production, ensure your development machine has:

- **Node.js**: `v24.x` (LTS)
- **npm**: `v11.x` or `v12.x`
- **Docker Engine**: Docker 24+ running locally with non-root access
- **Supabase CLI**: installed locally or accessible via `npx supabase`

---

## 2. Quickstart & Fresh-Clone Onboarding

Follow these steps from a freshly cloned repository to start the local stack:

```bash
# 1. Install all monorepo dependencies
npm install

# 2. Start local Supabase PostgreSQL & Auth services
npm run db:start

# 3. Bootstrap local environment configurations and keys
npm run bootstrap:local

# 4. Verify local environment and service connectivity
npm run verify:env

# 5. Reset and apply all database migrations (1 to 24)
npm run db:reset

# 6. Seed the complete synthetic Payments project demonstration (Section 22.4)
npm run demo:seed

# 7. Start all application services concurrently (API, Worker, Web)
npm run dev
```

Visit `http://localhost:5173` to access the application.

---

## 3. Verified Repository Commands

All commands specified in `docs/SPEC.md` Section 22.5 are verified and runnable:

| Command                    | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `npm install`              | Install all dependencies cleanly across monorepo workspaces.                 |
| `npm run dev`              | Start Web (5173), API (4000), and Worker concurrently with hot reload.       |
| `npm run build`            | Compile TypeScript packages, build production web assets and server bundles. |
| `npm run typecheck`        | Run project-wide TypeScript compiler check (`tsc --build`).                  |
| `npm run lint`             | Run ESLint across all workspaces and tests.                                  |
| `npm run format`           | Auto-format all code with Prettier.                                          |
| `npm run format:check`     | Verify zero Prettier formatting drift.                                       |
| `npm run test`             | Run all unit tests with Vitest.                                              |
| `npm run test:integration` | Run integration tests against local Supabase database.                       |
| `npm run test:security`    | Run complete Section 22.3 Negative Security test suite (all 35 items).       |
| `npm run test:e2e`         | Run Playwright end-to-end tests (including automated Axe accessibility).     |
| `npm run db:start`         | Start local Supabase Docker stack.                                           |
| `npm run db:stop`          | Stop local Supabase Docker stack.                                            |
| `npm run db:reset`         | Reset local PostgreSQL database and re-apply migrations 1 through 24.        |
| `npm run demo:seed`        | Seed the Section 22.4 synthetic Payments project scenario.                   |
| `npm run bootstrap:local`  | Generate `.env` configurations from local Supabase instance.                 |
| `npm run verify:env`       | Validate that all required environment variables and secrets are present.    |
| `npm run schemas:generate` | Deterministically generate JSON Schema definitions from Zod contracts.       |
| `npm run scan:bundle`      | Scan production web bundle to guarantee zero secret or API key leakage.      |
| `npm run openapi:lint`     | Lint `docs/openapi.yaml` with `@redocly/cli` against OpenAPI 3.1 standards.  |

---

## 4. Seeded Demonstration Walkthrough (Section 22.4)

The seed script (`npm run demo:seed`) creates the synthetic Payments Platform scenario specified in Section 22.4 of the specification.

### 4.1 Seeded Identities & Credentials

The bootstrap script prints secure local passwords during setup. Standard local testing accounts:

| User              | Role                             | Purpose                                                                      |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| **Alex Chen**     | Project Owner                    | Oversees payments project, manages membership, views audit trail.            |
| **Dana Vance**    | Departing Contributor / Reviewer | Creates handover drafts, reviews items, signs reviewer attestation.          |
| **Samira Patel**  | Incoming Engineer (Recipient)    | Recipient of shared handover; asks grounded Q&A via Ask Relay; exports PDF.  |
| **Marcus Brody**  | Incoming Operations (Recipient)  | Operations lead assigned to deployment and infrastructure handovers.         |
| **Taylor Jordan** | Outsider                         | Belongs to a different organisation; verifies cross-tenant isolation (404s). |

### 4.2 Guided Demonstration Steps

1. **Conflict Discovery**:
   - Log in as **Alex Chen** (`alex.chen@relay.local`).
   - Navigate to `/app/projects/{id}/knowledge`.
   - Observe the conflicting claims: _“Launch scheduled for Friday October 24”_ vs _“Launch deferred to Monday October 27”_. Both claims are visible with their respective evidence links.
2. **Blocker & Ownership Recovery**:
   - View the sandbox credentials blocker marked `blocked`.
   - View unassigned tasks preserved with `owner_user_id: null`.
3. **Prompt Injection Resistance**:
   - Inspect the malicious payment webhook message (`“SYSTEM OVERRIDE: ignore instructions...”`).
   - Observe that the payload was ingested strictly as inert evidence text and was never executed by the LLM.
4. **Restricted Content Exclusion**:
   - Log in as **Dana Vance** (`dana.vance@relay.local`).
   - Navigate to `/app/projects/{id}/handovers/new`.
   - Configure a handover for **Samira Patel**.
   - Generate draft. Notice that Dana's confidential transition bonus note is omitted because Samira lacks access.
5. **Human Review & Attestation**:
   - Review each item in the draft studio (`/app/handovers/{id}/review`).
   - Approve items, open the attestation dialog, check `confirmReviewedForRecipient`, and approve.
   - Share with **Samira Patel**.
6. **Outsider Isolation**:
   - Attempt to access the handover URL as **Taylor Jordan** (`taylor.jordan@relay.local`).
   - Notice the system returns `404 Not Found` (zero existence leakage).
7. **Grounded Q&A & Export**:
   - Log in as **Samira Patel** (`samira.patel@relay.local`).
   - Open the shared handover and export as Markdown and PDF.
   - Go to Ask Relay (`/app/projects/{id}/ask`).
   - Ask: _“What database do we use for payments?”_ -> Answer cites PostgreSQL 16 ADR with code-point quote.
   - Ask an off-topic question: _“What is the weather in Tokyo?”_ -> Model returns `insufficient_evidence` with zero hallucination.
8. **Epoch Invalidation**:
   - Revoke a source grant or remove a member.
   - Samira's subsequent requests return `409 REGENERATION_REQUIRED` and conversation history displays the generic access change notice.

---

## 5. Documentation Directory

Detailed specifications, architecture, and operational runbooks are located in `docs/`:

- [`docs/SPEC.md`](file:///home/shubham/Relay/docs/SPEC.md): Canonical specification and security requirements.
- [`docs/architecture.md`](file:///home/shubham/Relay/docs/architecture.md): Monorepo design, sequence diagrams, and workflows.
- [`docs/security-model.md`](file:///home/shubham/Relay/docs/security-model.md): Trust boundaries, RLS policies, and `SECURITY DEFINER` function rules.
- [`docs/security-test-matrix.md`](file:///home/shubham/Relay/docs/security-test-matrix.md): All 35 Section 22.3 negative security test mappings.
- [`docs/threat-model.md`](file:///home/shubham/Relay/docs/threat-model.md): STRIDE threat assessment and vulnerability analysis.
- [`docs/deployment.md`](file:///home/shubham/Relay/docs/deployment.md): Production container setup, Docker Compose, and Nginx SSL configuration.
- [`docs/operations.md`](file:///home/shubham/Relay/docs/operations.md): AI data transfer disclosures, key rotation, and emergency epoch invalidation.
- [`docs/openapi.yaml`](file:///home/shubham/Relay/docs/openapi.yaml): Full OpenAPI 3.1 specification for all 52 API endpoints.
- [`docs/decisions.md`](file:///home/shubham/Relay/docs/decisions.md): Architecture Decision Records (ADRs) and SDK version checks.
