# Manual Scenario Walkthrough & Testing Guide

This guide is for human verification of Relay across all 9 synthetic scenarios. It starts from a deterministically seeded local state and provides exact, step-by-step instructions through the browser.

---

## 1. Prerequisites & Seed Initialization

1. Ensure the local Supabase stack and dev servers are running:

   ```bash
   # Terminal 1: API Server
   npm run --workspace=@relay/api dev

   # Terminal 2: Web Server
   npm run --workspace=@relay/web dev
   ```

2. Seed the synthetic test data and print credentials:
   ```bash
   npm run scenarios:seed
   ```
   _Note: This command purges any previous `scn-*` data, creates fresh synthetic identities, and outputs their generated passwords to stdout once._

---

## 2. Walkthrough Checklist by Scenario

### Scenario 1: Onboarding and Workspace

- **User Identity**: Sign in as `scn-seed-owner-...@example.test`.
- **URL**: [http://localhost:5173/app](http://localhost:5173/app)
- **Steps**:
  1. Navigate to `/register` in an incognito window. Enter a new email `scn-manual-onboard@example.test`, display name, and password. Submit the form.
  2. Open Mailpit at [http://localhost:54324](http://localhost:54324). Find the confirmation email and click the confirmation link.
  3. Sign in at [http://localhost:5173/login](http://localhost:5173/login). Verify you land on `/app`.
  4. Create a new organisation `scn-org-manual` and a project `scn-proj-manual` using the `software_engineering` domain.
  5. Go to project settings `/app/projects/:projectId/members`. Add `scn-seed-reviewer-...@example.test` with role `Reviewer` and `scn-seed-recipient-...@example.test` with role `Recipient`.
  6. Attempt to remove yourself as the only Owner.
- **Pass Condition**:
  - Email confirmation succeeds via Mailpit.
  - Project and organisation are created.
  - Removing the last Owner fails with a clear error preventing orphaned projects.

---

### Scenario 2: Source Ingestion and Envelopes

- **User Identity**: Sign in as Reviewer (`scn-seed-reviewer-...@example.test`).
- **URL**: [http://localhost:5173/app/projects/:projectId/sources](http://localhost:5173/app/projects/:projectId/sources)
- **Steps**:
  1. Click **Import Source**. Select **Pasted Text**. Enter title `Manual Architecture ADR` and content:
     ```markdown
     We decided to adopt PostgreSQL 16 for all relational data.
     We propose Redis for session cache.
     ```
  2. Click **Submit**. Observe HTTP 201 in the browser Network tab.
  3. Click **Import Source** again. Select **JSON Envelope** (`messages.v1`). Paste a JSON payload with valid schema. Submit and observe HTTP 201.
  4. Try uploading an invalid JSON envelope (e.g. malformed JSON or mismatching format).
- **Pass Condition**:
  - Valid text and messages appear in the sources list.
  - Malformed or invalid envelopes display an immediate inline validation error without server crash.

---

### Scenario 3: Access Control & Tenant Isolation

- **User Identity**: Sign in as Reviewer and Recipient in separate browser profiles.
- **URL**: [http://localhost:5173/app/projects/:projectId/sources](http://localhost:5173/app/projects/:projectId/sources)
- **Steps**:
  1. **Reviewer Profile**: Import a source with `Restricted` visibility titled `Confidential Salary Reviews`.
  2. **Recipient Profile**: Refresh `/app/projects/:projectId/sources`.
  3. **Recipient Profile**: Check the total source count and list items.
  4. **Recipient Profile**: In DevTools, attempt to `fetch('/api/v1/sources/<restricted-id>')`.
- **Pass Condition**:
  - The restricted source is completely invisible to Recipient.
  - Direct GET request returns `HTTP 404 Not Found` (never 403, preserving identifier masking).

---

### Scenario 4: Knowledge Extraction & Conflict Detection

- **User Identity**: Sign in as Reviewer (`scn-seed-reviewer-...@example.test`).
- **URL**: [http://localhost:5173/app/projects/:projectId/knowledge](http://localhost:5173/app/projects/:projectId/knowledge)
- **Steps**:
  1. Verify the Knowledge page displays extracted claims grouped by category:
     - Decisions (`PostgreSQL 16`)
     - Blockers (`Sandbox credentials missing`)
     - Tasks (`Audit log service`)
  2. Check for conflicting claims:
     - "We plan to launch payments integration on Friday" vs "We will launch payments integration on Monday".
  3. Check the prompt injection text: verify the adversarial text is rendered inertly as evidence and did not execute commands or elevate privileges.
- **Pass Condition**:
  - Claims are displayed with valid evidence tags (`supported`, `conflicting`).
  - Contradiction between Friday and Monday is highlighted.

---

### Scenario 5: Clarifications & Reviewer Context

- **User Identity**: Sign in as Reviewer (`scn-seed-reviewer-...@example.test`).
- **URL**: [http://localhost:5173/app/projects/:projectId/questions](http://localhost:5173/app/projects/:projectId/questions)
- **Steps**:
  1. View the open clarification question regarding the Friday vs Monday launch conflict.
  2. Click **Answer Question**. Enter explanation:
     ```
     The launch was rescheduled to Monday after security review.
     ```
  3. Submit the answer.
  4. Navigate to `/app/projects/:projectId/knowledge` and confirm the new reviewer-context claim is present.
  5. Flag a doubtful claim using the **Flag Claim** action and observe state downgrade.
- **Pass Condition**:
  - Question status updates to answered.
  - Reviewer-context claim is linked as evidence.
  - Flagged claim reflects doubtful evidence state.

---

### Scenario 6: Handover Review and Approval Lifecycle

- **User Identity**: Sign in as Reviewer (`scn-seed-reviewer-...@example.test`).
- **URL**: [http://localhost:5173/app/projects/:projectId/handovers](http://localhost:5173/app/projects/:projectId/handovers)
- **Steps**:
  1. Open the existing draft handover or click **Generate Handover**.
  2. On the review screen (`/app/handovers/:id/review`):
     - Edit an item's wording. Verify "Edited by reviewer; wording not machine-verified" badge appears.
     - Review all pending items (click **Approve** or **Reject**).
     - Notice the **Approve Draft** button is enabled only when zero items are pending.
  3. Click **Approve Draft**. In the attestation modal, check `confirmReviewedForRecipient` and confirm.
  4. Click **Share with Recipient**.
- **Pass Condition**:
  - Handover status transitions: `draft` -> `approved` -> `shared`.
  - Recipient can now access the handover.

---

### Scenario 7: Recipient Handover View, Q&A, and Export

- **User Identity**: Sign in as Recipient (`scn-seed-recipient-...@example.test`).
- **URL**: [http://localhost:5173/app/handovers/:id](http://localhost:5173/app/handovers/:id)
- **Steps**:
  1. Open the shared handover. Verify all approved items, evidence citations, and uncertainty labels render properly.
  2. Verify zero restricted bonus or password content appears.
  3. Click **Export** in the top-right menu:
     - Select **Export as Markdown**. Verify file downloads with `.md` extension, valid metadata headers, and plain-text URLs.
     - Select **Export as PDF**. Verify valid binary PDF file downloads and renders cleanly.
  4. Navigate to **Ask Q&A** (`/app/projects/:projectId/ask`):
     - Ask: _"What database was chosen for transactional data?"_ -> Expect answered status citing PostgreSQL ADR.
     - Ask: _"What is the weather on Mars?"_ -> Expect insufficient evidence status with 0 claims.
- **Pass Condition**:
  - Recipient sees shared handover without restricted leakage.
  - Markdown and PDF exports download cleanly.
  - Q&A answers grounded questions and short-circuits off-topic questions.

---

### Scenario 8: Revocation and Staleness

- **User Identity**: Reviewer & Recipient profiles.
- **URL**: [http://localhost:5173/app/handovers/:id](http://localhost:5173/app/handovers/:id)
- **Steps**:
  1. **Reviewer Profile**: Navigate to `/app/projects/:projectId/members`. Remove the Contributor member (or archive a source in `/sources`).
  2. **Recipient Profile**: Return to the shared handover page and refresh the browser.
  3. Inspect the UI and Network tab:
     - Network response for `GET /api/v1/handovers/:id` returns `HTTP 409 REGENERATION_REQUIRED`.
     - UI displays the Stale Handover notice explaining that project permissions changed.
  4. **Recipient Profile**: Open Q&A `/app/projects/:projectId/ask`. Verify the generic notice: _"Conversation history before the last access change is unavailable."_
  5. **Reviewer Profile**: Create revision v2, approve, and share.
  6. **Recipient Profile**: View v2 and confirm access is restored.
- **Pass Condition**:
  - Stale handover is blocked immediately with 409 `REGENERATION_REQUIRED`.
  - Q&A history older than access change is masked.
  - Re-sharing restores recipient access.

---

### Scenario 9: Security Hardening & Hygiene

- **User Identity**: Any signed-in user or anonymous curl.
- **Steps**:
  1. In browser DevTools Network tab, inspect any API response headers. Verify:
     - `Content-Security-Policy: default-src 'self' ...`
     - `X-Content-Type-Options: nosniff`
     - `Referrer-Policy: no-referrer`
     - `Strict-Transport-Security: max-age=31536000`
  2. Provoke a 404 or 422 error (e.g. navigating to `/api/v1/projects/00000000-0000-0000-0000-000000000000`). Verify the response body contains only `{ error: { code, message, details }, requestId }` with no database stack traces or SQL strings.
  3. Run the bundle secret scanner:
     ```bash
     npm run scan:bundle
     ```
- **Pass Condition**:
  - All security headers present.
  - Zero SQL or internal stack leakages in error envelopes.
  - Bundle scanner passes with 0 secret findings.
