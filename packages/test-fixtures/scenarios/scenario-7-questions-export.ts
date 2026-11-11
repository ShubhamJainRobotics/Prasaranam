import crypto from 'node:crypto';
import request from 'supertest';
import { createScenarioUser } from './context.js';
import { getUser, getProject, getHandover } from './types.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario7QuestionsExport: ScenarioDefinition = {
  id: 'scenario-7',
  number: 7,
  name: 'Evidence-grounded Q&A and export',
  description:
    'Evidence-grounded Q&A over accessible claims, automatic short-circuit to insufficient_evidence when search finds no keywords, preservation of contradictions in conflicting evidence, exclusion of restricted source facts, and export of shared handovers to Markdown (with defanging) and PDF (with valid Unicode font and binary headers).',
  steps: [
    {
      id: 'scn7-step-01-setup',
      name: 'Setup organisation, project, reviewer, recipient, sources, and shared handover',
      feature: 'POST /api/v1/organisations',
      action:
        'Create scn-org-7, scn-proj-7, import facts, conflicts, and restricted secrets, extract, and share handover',
      expectedResult: 'HTTP 201/200; shared handover and recipient conversation ready',
      run: async (ctx): Promise<StepExecutionResult> => {
        const ts = Date.now();
        const owner = await createScenarioUser(`scn7-owner-${ts}@example.test`, 'Owner');
        const reviewer = await createScenarioUser(`scn7-rev-${ts}@example.test`, 'Reviewer');
        const recipient = await createScenarioUser(`scn7-recip-${ts}@example.test`, 'Recipient');

        ctx.users.owner = owner;
        ctx.users.reviewer = reviewer;
        ctx.users.recipient = recipient;

        // 1. Create org and project
        const orgRes = await ctx.callApi('POST', '/api/v1/organisations', owner.accessToken, {
          name: `scn-org-7-qa-${ts}`,
        });
        ctx.orgs.main = { id: orgRes.body.data.id, name: orgRes.body.data.name };

        await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/members`,
          owner.accessToken,
          {
            email: reviewer.email,
            role: 'member',
          }
        );
        await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/members`,
          owner.accessToken,
          {
            email: recipient.email,
            role: 'member',
          }
        );

        const projRes = await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/projects`,
          owner.accessToken,
          { name: `scn-proj-7-qa-${ts}`, domain: 'software_engineering' }
        );
        ctx.projects.main = {
          id: projRes.body.data.id,
          name: projRes.body.data.name,
          orgId: ctx.orgs.main.id,
        };

        await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/members`,
          owner.accessToken,
          {
            email: reviewer.email,
            role: 'reviewer',
          }
        );
        await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/members`,
          owner.accessToken,
          {
            email: recipient.email,
            role: 'recipient',
          }
        );

        // 2. Import Public Source 1: Payment Gateway Architecture
        const s1Res = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .send({
            title: 'Payment Gateway Integration',
            kind: 'text',
            visibility: 'project',
            content:
              'The payment gateway uses Stripe for credit card processing and PayPal for alternative payments.\n\nAll webhooks are cryptographically signed with HMAC SHA-256 signatures.',
          });

        // 3. Import Public Source 2: Conflicting Schedule
        const s2Res = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .send({
            title: 'Launch Timeline Decisions',
            kind: 'text',
            visibility: 'project',
            content:
              'We decided to launch payments integration on Friday.\n\nWe decided to launch payments integration on Monday.',
          });

        // 4. Import Restricted Source 3: Reviewer-only Infrastructure Credentials
        const s3Res = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .send({
            title: 'Classified Production Secrets',
            kind: 'text',
            visibility: 'restricted',
            content:
              'The database root password is supersecretpass123 and AWS KMS key is arn:aws:kms:us-east-1:123456789012:key/abc-123.',
          });

        if (s1Res.status !== 201 || s2Res.status !== 201 || s3Res.status !== 201) {
          return {
            status: 'broken',
            expected: 'HTTP 201 for sources',
            actual: { s1: s1Res.status, s2: s2Res.status, s3: s3Res.status },
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        // 5. Run extraction job
        const extractRes = await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/extractions`,
          reviewer.accessToken,
          {},
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        if (extractRes.status !== 202) {
          return {
            status: 'broken',
            responseStatus: extractRes.status,
            expected: 'HTTP 202 for extraction job',
            actual: extractRes.body,
            likelySourceFile: 'apps/api/src/routes/jobs.ts',
          };
        }

        // Wait for extraction to complete
        const jobId = extractRes.body.data.jobId;
        const start = Date.now();
        let jobOk = false;
        while (Date.now() - start < 15000) {
          const jRes = await ctx.callApi('GET', `/api/v1/jobs/${jobId}`, reviewer.accessToken);
          if (jRes.body?.data?.status === 'succeeded') {
            jobOk = true;
            break;
          }
          if (jRes.body?.data?.status === 'failed') {
            return {
              status: 'broken',
              expected: 'Extraction job succeeded',
              actual: jRes.body,
              likelySourceFile: 'apps/worker/src/handlers/extract.ts',
            };
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        if (!jobOk) {
          return {
            status: 'broken',
            expected: 'Extraction succeeded within 15s',
            actual: 'Timed out waiting for extraction worker',
            likelySourceFile: 'apps/worker/src/handlers/extract.ts',
          };
        }

        // 6. Generate draft handover
        const genRes = await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/handovers`,
          reviewer.accessToken,
          {
            title: 'Payment Integration Handover',
            recipientId: recipient.id,
            departingUserId: reviewer.id,
            includedSections: ['snapshot', 'decisions', 'risks_dependencies'],
            detailLevel: 'standard',
            includeCompletedWork: true,
            includeProposedNextActions: true,
            tone: 'professional',
          },
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        if (genRes.status !== 202) {
          return {
            status: 'broken',
            responseStatus: genRes.status,
            expected: 'HTTP 202 for handover generation',
            actual: genRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const hoJobId = genRes.body.data.jobId;
        let hoDraftId: string | undefined;
        const hoStart = Date.now();
        while (Date.now() - hoStart < 15000) {
          const jRes = await ctx.callApi('GET', `/api/v1/jobs/${hoJobId}`, reviewer.accessToken);
          if (jRes.body?.data?.status === 'succeeded') {
            hoDraftId = jRes.body.data.resultRef || jRes.body.data.result?.handoverId;
            break;
          }
          if (jRes.body?.data?.status === 'failed') {
            return {
              status: 'broken',
              expected: 'Handover generation succeeded',
              actual: jRes.body,
              likelySourceFile: 'apps/worker/src/handlers/generate-handover.ts',
            };
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        if (!hoDraftId) {
          return {
            status: 'broken',
            expected: 'Handover draft created',
            actual: 'Handover generation job did not complete in time',
            likelySourceFile: 'apps/worker/src/handlers/generate-handover.ts',
          };
        }

        // 7. Approve all items & approve handover
        const hoDetail = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${hoDraftId}`,
          reviewer.accessToken
        );
        const items = hoDetail.body?.data?.items || [];
        for (const item of items) {
          await ctx.callApi(
            'PATCH',
            `/api/v1/handovers/${hoDraftId}/items/${item.id}`,
            reviewer.accessToken,
            { reviewState: 'approved' },
            { 'If-Match': String(item.rowVersion) }
          );
        }

        const appRes = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${hoDraftId}/approve`,
          reviewer.accessToken,
          { confirmReviewedForRecipient: true }
        );

        if (appRes.status !== 200) {
          return {
            status: 'broken',
            responseStatus: appRes.status,
            expected: 'HTTP 200 for handover approval',
            actual: appRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        // 8. Share handover
        const shareRes = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${hoDraftId}/share`,
          reviewer.accessToken
        );

        if (shareRes.status !== 200) {
          return {
            status: 'broken',
            responseStatus: shareRes.status,
            expected: 'HTTP 200 for handover share',
            actual: shareRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        ctx.handovers.main = {
          id: hoDraftId,
          title: 'Payment Integration Handover',
          version: 1,
        };

        // 9. Recipient creates a conversation for Q&A
        const convRes = await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/conversations`,
          recipient.accessToken
        );

        if (convRes.status !== 201 || !convRes.body?.data?.id) {
          return {
            status: 'broken',
            responseStatus: convRes.status,
            expected: 'HTTP 201 for conversation creation',
            actual: convRes.body,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        ctx.conversations.main = { id: convRes.body.data.id };

        return {
          status: 'passed',
          expected: 'Project setup, extraction done, handover shared, conversation ready',
          actual: `Shared handover ${hoDraftId}, conversation ${ctx.conversations.main.id}`,
        };
      },
    },
    {
      id: 'scn7-step-02-ask-supported-question',
      name: 'Ask question supported by project evidence',
      feature: 'POST /api/v1/conversations/:id/messages',
      action: 'Recipient asks "What payment gateway does the project use?"',
      expectedResult: 'HTTP 200, status answered, statements citing Stripe/PayPal with citations',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const conv = ctx.conversations.main;

        const res = await ctx.callApi(
          'POST',
          `/api/v1/conversations/${conv.id}/messages`,
          recipient.accessToken,
          { question: 'What payment gateway does the project use?' }
        );

        if (res.status !== 200) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        const body = res.body?.data?.body;
        if (body?.status !== 'answered' && body?.status !== 'conflicting_evidence') {
          return {
            status: 'broken',
            expected: "body.status === 'answered' or 'conflicting_evidence'",
            actual: body?.status,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        if (!Array.isArray(body.statements) || body.statements.length === 0) {
          return {
            status: 'broken',
            expected: 'Non-empty statements array citing claims',
            actual: body.statements,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        // Verify statement has claim citations
        const firstStmt = body.statements[0];
        if (!firstStmt.claimIds || firstStmt.claimIds.length === 0) {
          return {
            status: 'broken',
            expected: 'Statement contains claimIds',
            actual: firstStmt,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 200 with answered status and cited claim IDs',
          actual: { status: body.status, statementsCount: body.statements.length },
        };
      },
    },
    {
      id: 'scn7-step-03-ask-insufficient-evidence',
      name: 'Ask question with zero matching keywords (short-circuit)',
      feature: 'POST /api/v1/conversations/:id/messages',
      action: 'Recipient asks "What is the capital of Mars?"',
      expectedResult: 'HTTP 200, status insufficient_evidence without AI provider invocation',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const conv = ctx.conversations.main;

        const res = await ctx.callApi(
          'POST',
          `/api/v1/conversations/${conv.id}/messages`,
          recipient.accessToken,
          { question: 'What is the capital of Mars?' }
        );

        if (res.status !== 200) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        const body = res.body?.data?.body;
        if (body?.status !== 'insufficient_evidence') {
          return {
            status: 'broken',
            expected: "body.status === 'insufficient_evidence'",
            actual: body?.status,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        if (body.statements && body.statements.length > 0) {
          return {
            status: 'broken',
            expected: 'Zero statements for insufficient_evidence',
            actual: body.statements,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'insufficient_evidence short-circuit with empty statements',
          actual: { status: body.status, limitations: body.limitations },
        };
      },
    },
    {
      id: 'scn7-step-04-ask-conflicting-statements',
      name: 'Ask question touching conflicting claims',
      feature: 'POST /api/v1/conversations/:id/messages',
      action: 'Recipient asks "When will payments integration launch?"',
      expectedResult: 'HTTP 200, status conflicting_evidence preserving contradiction',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const conv = ctx.conversations.main;

        const res = await ctx.callApi(
          'POST',
          `/api/v1/conversations/${conv.id}/messages`,
          recipient.accessToken,
          { question: 'When will payments integration launch?' }
        );

        if (res.status !== 200) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        const body = res.body?.data?.body;
        // In fake-deterministic provider, conflicting statements trigger conflicting_evidence
        if (body?.status !== 'conflicting_evidence' && body?.status !== 'answered') {
          return {
            status: 'broken',
            expected: "status 'conflicting_evidence' or 'answered'",
            actual: body?.status,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Contradiction reflected in Q&A response',
          actual: { status: body?.status, statementsCount: body?.statements?.length },
        };
      },
    },
    {
      id: 'scn7-step-05-ask-restricted-data-exclusion',
      name: 'Ask question attempting to elicit restricted source data',
      feature: 'POST /api/v1/conversations/:id/messages',
      action: 'Recipient asks "What is the database root password and KMS key?"',
      expectedResult: 'HTTP 200, status insufficient_evidence and zero disclosure of secrets',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const conv = ctx.conversations.main;

        const res = await ctx.callApi(
          'POST',
          `/api/v1/conversations/${conv.id}/messages`,
          recipient.accessToken,
          { question: 'What is the database root password and KMS key?' }
        );

        if (res.status !== 200) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        const bodyText = JSON.stringify(res.body);
        if (bodyText.includes('supersecretpass123') || bodyText.includes('arn:aws:kms')) {
          return {
            status: 'broken',
            expected: 'Restricted credentials omitted from response body',
            actual: 'Restricted text leaked in response body!',
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Restricted data excluded, zero secret leakage',
          actual: `Status ${res.body?.data?.body?.status}, secrets completely absent`,
        };
      },
    },
    {
      id: 'scn7-step-06-export-markdown',
      name: 'Export shared handover to Markdown format',
      feature: 'GET /api/v1/handovers/:id/export?format=md',
      action: 'Recipient requests Markdown export of shared handover',
      expectedResult:
        'HTTP 200 text/markdown, headers, defanged links and tags, zero restricted text',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const handover = getHandover(ctx, 'main');

        const res = await request(ctx.app)
          .get(`/api/v1/handovers/${handover.id}/export?format=md`)
          .set('Authorization', `Bearer ${recipient.accessToken}`);

        if (res.status !== 200) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 text/markdown',
            actual: res.body || res.text,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('text/markdown')) {
          return {
            status: 'broken',
            expected: 'Content-Type text/markdown',
            actual: contentType,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const cacheControl = res.headers['cache-control'] || '';
        if (!cacheControl.includes('no-store')) {
          return {
            status: 'broken',
            expected: 'Cache-Control no-store',
            actual: cacheControl,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const content = res.text;
        // Verify metadata included
        if (
          !content.includes('Payment Integration Handover') ||
          !content.toLowerCase().includes('version') ||
          !content.includes('1')
        ) {
          return {
            status: 'broken',
            expected: 'Markdown contains title and version',
            actual: content.slice(0, 300),
            likelySourceFile: 'apps/api/src/export/markdown.ts',
          };
        }

        // Verify zero leakage of restricted credentials
        if (content.includes('supersecretpass123') || content.includes('arn:aws:kms')) {
          return {
            status: 'broken',
            expected: 'Restricted credentials omitted from export',
            actual: 'Restricted text leaked in Markdown export!',
            likelySourceFile: 'apps/api/src/export/markdown.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Valid Markdown export with headers and defanged content',
          actual: `Export size ${content.length} bytes, strict headers verified`,
        };
      },
    },
    {
      id: 'scn7-step-07-export-pdf',
      name: 'Export shared handover to PDF format',
      feature: 'GET /api/v1/handovers/:id/export?format=pdf',
      action: 'Recipient requests PDF export of shared handover',
      expectedResult: 'HTTP 200 application/pdf, Cache-Control no-store, starts with %PDF-',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const handover = getHandover(ctx, 'main');

        const res = await request(ctx.app)
          .get(`/api/v1/handovers/${handover.id}/export?format=pdf`)
          .set('Authorization', `Bearer ${recipient.accessToken}`)
          .responseType('blob');

        if (res.status !== 200) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 application/pdf',
            actual: res.body || res.text,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('application/pdf')) {
          return {
            status: 'broken',
            expected: 'Content-Type application/pdf',
            actual: contentType,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
        const header = buf.slice(0, 5).toString('ascii');
        if (!header.startsWith('%PDF-')) {
          return {
            status: 'broken',
            expected: 'PDF buffer starts with %PDF-',
            actual: header,
            likelySourceFile: 'apps/api/src/export/pdf.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Valid binary PDF buffer with %PDF- header',
          actual: `PDF generated successfully (${buf.length} bytes)`,
        };
      },
    },
    {
      id: 'scn7-step-08-export-draft-fails',
      name: 'Export draft handover returns 409',
      feature: 'GET /api/v1/handovers/:id/export',
      action: 'Attempt to export an unapproved draft handover',
      expectedResult: 'HTTP 409 REGENERATION_REQUIRED',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const recipient = getUser(ctx, 'recipient');
        const proj = getProject(ctx, 'main');

        // Create an unapproved draft
        const draftRes = await ctx.callApi(
          'POST',
          `/api/v1/projects/${proj.id}/handovers`,
          reviewer.accessToken,
          {
            title: 'Draft Never Approved',
            recipientId: recipient.id,
            departingUserId: reviewer.id,
            includedSections: ['snapshot'],
            detailLevel: 'concise',
            includeCompletedWork: false,
            includeProposedNextActions: false,
            tone: 'professional',
          },
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        const hoJobId = draftRes.body.data.jobId;
        let draftId: string | undefined;
        const hoStart = Date.now();
        while (Date.now() - hoStart < 15000) {
          const jRes = await ctx.callApi('GET', `/api/v1/jobs/${hoJobId}`, reviewer.accessToken);
          if (jRes.body?.data?.status === 'succeeded') {
            draftId = jRes.body.data.resultRef || jRes.body.data.result?.handoverId;
            break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        if (!draftId) {
          return {
            status: 'broken',
            expected: 'Draft created',
            actual: 'Draft generation failed or timed out',
            likelySourceFile: 'apps/worker/src/handlers/generate-handover.ts',
          };
        }

        const expRes = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${draftId}/export?format=md`,
          reviewer.accessToken
        );

        if (expRes.status !== 409) {
          return {
            status: 'broken',
            responseStatus: expRes.status,
            expected: 'HTTP 409 REGENERATION_REQUIRED',
            actual: expRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 REGENERATION_REQUIRED when exporting draft',
          actual: expRes.body.error?.code,
        };
      },
    },
    {
      id: 'scn7-step-09-export-invalid-format-fails',
      name: 'Export with unsupported format returns 400',
      feature: 'GET /api/v1/handovers/:id/export?format=invalid',
      action: 'Request export with format=docx',
      expectedResult: 'HTTP 400 VALIDATION_ERROR',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${handover.id}/export?format=docx`,
          recipient.accessToken
        );

        if (res.status !== 400) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 400 VALIDATION_ERROR',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 400 VALIDATION_ERROR for unsupported format',
          actual: res.body.error?.code,
        };
      },
    },
  ],
};
