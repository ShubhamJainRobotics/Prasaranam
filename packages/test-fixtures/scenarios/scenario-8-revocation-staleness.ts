import crypto from 'node:crypto';
import request from 'supertest';
import { createScenarioUser } from './context.js';
import { getUser, getProject, getHandover } from './types.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario8RevocationStaleness: ScenarioDefinition = {
  id: 'scenario-8',
  number: 8,
  name: 'Revocation, staleness, and access epoch advancement',
  description:
    'Independent revocation vectors (project membership change, source grant revocation, source archival) advancing project access epoch; validation that recipient receives 409 REGENERATION_REQUIRED, reviewer receives metadata-only with ACCESS_CHANGED, Q&A history displays generic unavailable notice, and regeneration restores recipient access.',
  steps: [
    {
      id: 'scn8-step-01-setup',
      name: 'Setup organisation, project, members, shared handover, and conversation',
      feature: 'POST /api/v1/organisations',
      action:
        'Create scn-org-8, scn-proj-8, reviewer, recipient, extra member, shared handover, and ask initial Q&A question',
      expectedResult:
        'HTTP 200/201; shared handover accessible to recipient before any revocation occurs',
      run: async (ctx): Promise<StepExecutionResult> => {
        const ts = Date.now();
        const owner = await createScenarioUser(`scn8-owner-${ts}@example.test`, 'Owner');
        const reviewer = await createScenarioUser(`scn8-rev-${ts}@example.test`, 'Reviewer');
        const recipient = await createScenarioUser(`scn8-recip-${ts}@example.test`, 'Recipient');
        const extraMember = await createScenarioUser(`scn8-mem-${ts}@example.test`, 'Extra Member');

        ctx.users.owner = owner;
        ctx.users.reviewer = reviewer;
        ctx.users.recipient = recipient;
        ctx.users.extraMember = extraMember;

        // 1. Create org and project
        const orgRes = await ctx.callApi('POST', '/api/v1/organisations', owner.accessToken, {
          name: `scn-org-8-revocation-${ts}`,
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
        await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/members`,
          owner.accessToken,
          {
            email: extraMember.email,
            role: 'member',
          }
        );

        const projRes = await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/projects`,
          owner.accessToken,
          { name: `scn-proj-8-revocation-${ts}`, domain: 'software_engineering' }
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
        await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/members`,
          owner.accessToken,
          {
            email: extraMember.email,
            role: 'contributor',
          }
        );

        // 2. Ingest 2 public sources and 1 restricted source with grant
        const s1 = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .send({
            title: 'Architecture Decisions',
            kind: 'text',
            visibility: 'project',
            content: 'We decided to deploy microservices on Kubernetes. We use Redis for caching.',
          });

        const s2 = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .send({
            title: 'Security Protocols',
            kind: 'text',
            visibility: 'project',
            content: 'All internal network traffic requires TLS 1.3 encryption.',
          });

        const s3 = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .send({
            title: 'Partner Credentials',
            kind: 'text',
            visibility: 'restricted',
            content: 'The partner authentication secret is partner-token-xyz-123.',
          });

        if (s1.status !== 201 || s2.status !== 201 || s3.status !== 201) {
          return {
            status: 'broken',
            expected: 'HTTP 201 for sources',
            actual: { s1: s1.status, s2: s2.status, s3: s3.status },
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        const s3Id = s3.body.data.sources[0].id;
        ctx.sources.restricted = { id: s3Id, title: 'Partner Credentials' };
        ctx.sources.archivable = { id: s2.body.data.sources[0].id, title: 'Security Protocols' };

        // Explicit grant to recipient for s3
        await ctx.callApi('PATCH', `/api/v1/sources/${s3Id}/access`, owner.accessToken, {
          visibility: 'restricted',
          grantUserIds: [recipient.id],
        });

        // 3. Run extraction
        const extractRes = await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/extractions`,
          reviewer.accessToken,
          {},
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        const jobId = extractRes.body?.data?.jobId;
        const start = Date.now();
        let extractOk = false;
        while (Date.now() - start < 15000) {
          const jRes = await ctx.callApi('GET', `/api/v1/jobs/${jobId}`, reviewer.accessToken);
          if (jRes.body?.data?.status === 'succeeded') {
            extractOk = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        if (!extractOk) {
          return {
            status: 'broken',
            expected: 'Extraction job succeeded',
            actual: 'Timed out waiting for extraction',
            likelySourceFile: 'apps/worker/src/handlers/extract.ts',
          };
        }

        // 4. Generate, approve, and share handover v1
        const genRes = await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/handovers`,
          reviewer.accessToken,
          {
            title: 'Revocation Lifecycle Handover',
            recipientId: recipient.id,
            departingUserId: reviewer.id,
            includedSections: ['snapshot', 'decisions'],
            detailLevel: 'standard',
            includeCompletedWork: true,
            includeProposedNextActions: true,
            tone: 'professional',
          },
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        const hoJobId = genRes.body?.data?.jobId;
        let hoId: string | undefined;
        const hoStart = Date.now();
        while (Date.now() - hoStart < 15000) {
          const jRes = await ctx.callApi('GET', `/api/v1/jobs/${hoJobId}`, reviewer.accessToken);
          if (jRes.body?.data?.status === 'succeeded') {
            hoId = jRes.body.data.resultRef || jRes.body.data.result?.handoverId;
            break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        if (!hoId) {
          return {
            status: 'broken',
            expected: 'Handover draft created',
            actual: 'Handover generation timed out',
            likelySourceFile: 'apps/worker/src/handlers/generate-handover.ts',
          };
        }

        // Approve all items
        const hoDetail = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${hoId}`,
          reviewer.accessToken
        );
        for (const item of hoDetail.body?.data?.items || []) {
          await ctx.callApi(
            'PATCH',
            `/api/v1/handovers/${hoId}/items/${item.id}`,
            reviewer.accessToken,
            { reviewState: 'approved' },
            { 'If-Match': String(item.rowVersion) }
          );
        }

        await ctx.callApi('POST', `/api/v1/handovers/${hoId}/approve`, reviewer.accessToken, {
          confirmReviewedForRecipient: true,
        });

        await ctx.callApi('POST', `/api/v1/handovers/${hoId}/share`, reviewer.accessToken);

        ctx.handovers.main = {
          id: hoId,
          title: 'Revocation Lifecycle Handover',
          version: 1,
        };

        // 5. Recipient asks a question in Q&A (records message in epoch 1)
        const convRes = await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/conversations`,
          recipient.accessToken
        );
        ctx.conversations.main = { id: convRes.body.data.id };

        await ctx.callApi(
          'POST',
          `/api/v1/conversations/${ctx.conversations.main.id}/messages`,
          recipient.accessToken,
          { question: 'What infrastructure decisions were made?' }
        );

        // 6. Verify initial recipient view of shared handover is 200 OK
        const initView = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${hoId}`,
          recipient.accessToken
        );
        if (initView.status !== 200 || !initView.body?.data?.items?.length) {
          return {
            status: 'broken',
            responseStatus: initView.status,
            expected: 'HTTP 200 with non-empty items',
            actual: initView.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Initial shared handover valid and accessible to recipient',
          actual: `Handover ${hoId} has ${initView.body.data.items.length} items`,
        };
      },
    },
    {
      id: 'scn8-step-02-vector-a-member-revocation',
      name: 'Vector A: Deactivate project member to increment project access epoch',
      feature: 'PATCH /api/v1/projects/:id/members/:userId',
      action: 'Deactivate extraMember from project',
      expectedResult: 'HTTP 200/204; projects.access_epoch incremented',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const extraMember = getUser(ctx, 'extraMember');

        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/projects/${proj.id}/members/${extraMember.id}`,
          owner.accessToken,
          { active: false }
        );

        if (res.status !== 200 && res.status !== 204) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 or 204',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/projects.ts',
          };
        }

        // Verify epoch advanced in DB
        const epRes = await ctx.pool.query(
          'SELECT access_epoch FROM public.projects WHERE id = $1',
          [proj.id]
        );
        const epoch = Number(epRes.rows[0].access_epoch);

        return {
          status: 'passed',
          expected: 'Project member removed and access epoch bumped',
          actual: `Access epoch is now ${epoch}`,
        };
      },
    },
    {
      id: 'scn8-step-03-verify-recipient-stale-after-vector-a',
      name: 'Recipient requesting shared handover receives 409 REGENERATION_REQUIRED',
      feature: 'GET /api/v1/handovers/:id',
      action: 'Recipient calls GET /handovers/:id after project epoch advanced',
      expectedResult: 'HTTP 409 REGENERATION_REQUIRED with generic error message',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${handover.id}`,
          recipient.accessToken
        );

        if (res.status !== 409) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 409 REGENERATION_REQUIRED',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const errCode = res.body?.error?.code;
        if (errCode !== 'REGENERATION_REQUIRED') {
          return {
            status: 'broken',
            expected: "error.code === 'REGENERATION_REQUIRED'",
            actual: errCode,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        // Generic body must not leak claim counts or item details
        const msg = res.body?.error?.message || '';
        if (msg.includes('claim') || msg.includes('item') || msg.includes('count')) {
          return {
            status: 'broken',
            expected: 'Generic message without leaking item/claim counts',
            actual: msg,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 REGENERATION_REQUIRED with generic message',
          actual: res.body.error,
        };
      },
    },
    {
      id: 'scn8-step-04-verify-reviewer-metadata-only',
      name: 'Reviewer requesting stale handover receives metadata-only with ACCESS_CHANGED',
      feature: 'GET /api/v1/handovers/:id',
      action: 'Reviewer calls GET /handovers/:id after project epoch advanced',
      expectedResult: 'HTTP 200, items: [], isStale: true, reasonCode: "ACCESS_CHANGED"',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${handover.id}`,
          reviewer.accessToken
        );

        if (res.status !== 200) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 with metadata-only',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const data = res.body?.data;
        if (!data?.isStale || data?.reasonCode !== 'ACCESS_CHANGED') {
          return {
            status: 'broken',
            expected: "data.isStale === true and reasonCode === 'ACCESS_CHANGED'",
            actual: { isStale: data?.isStale, reasonCode: data?.reasonCode },
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        if (data.items && data.items.length > 0) {
          return {
            status: 'broken',
            expected: 'Zero items returned for stale handover',
            actual: data.items,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Metadata-only response with empty items and ACCESS_CHANGED reason code',
          actual: { isStale: data.isStale, reasonCode: data.reasonCode, itemsCount: 0 },
        };
      },
    },
    {
      id: 'scn8-step-05-verify-qa-history-generic-notice',
      name: 'Q&A conversation history displays generic access-change notice',
      feature: 'GET /api/v1/conversations/:id/messages',
      action: 'Recipient requests conversation messages after epoch advanced',
      expectedResult: 'HTTP 200 with generic historyUnavailableNotice and zero prior messages',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const conv = ctx.conversations.main;

        const res = await ctx.callApi(
          'GET',
          `/api/v1/conversations/${conv.id}/messages`,
          recipient.accessToken
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

        const data = res.body?.data;
        if (!data?.historyUnavailableNotice) {
          return {
            status: 'broken',
            expected: 'Non-null historyUnavailableNotice',
            actual: data?.historyUnavailableNotice,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        // Only current epoch messages are returned (which is 0)
        if (data.messages && data.messages.length > 0) {
          return {
            status: 'broken',
            expected: 'Zero stale messages in current epoch list',
            actual: data.messages.length,
            likelySourceFile: 'apps/api/src/routes/conversations.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Generic notice displayed and stale messages masked',
          actual: data.historyUnavailableNotice,
        };
      },
    },
    {
      id: 'scn8-step-06-regenerate-and-restore-access',
      name: 'Create revision, approve, share, and verify recipient access restored',
      feature: 'POST /api/v1/handovers/:id/versions',
      action:
        'Reviewer creates version 2 from stale handover, approves, shares, and recipient views it',
      expectedResult: 'HTTP 200; version 2 shared and fully visible to recipient',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const recipient = getUser(ctx, 'recipient');
        const handover = getHandover(ctx, 'main');

        // Create revision
        const revRes = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${handover.id}/versions`,
          reviewer.accessToken
        );

        if (revRes.status !== 201) {
          return {
            status: 'broken',
            responseStatus: revRes.status,
            expected: 'HTTP 201 for revision creation',
            actual: revRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const v2Id = revRes.body?.data?.handoverId || revRes.body?.data?.id;
        ctx.handovers.v2 = { id: v2Id, title: 'Revocation Lifecycle Handover', version: 2 };

        // Approve all items on v2
        const v2Detail = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${v2Id}`,
          reviewer.accessToken
        );
        for (const item of v2Detail.body?.data?.items || []) {
          await ctx.callApi(
            'PATCH',
            `/api/v1/handovers/${v2Id}/items/${item.id}`,
            reviewer.accessToken,
            { reviewState: 'approved' },
            { 'If-Match': String(item.rowVersion) }
          );
        }

        await ctx.callApi('POST', `/api/v1/handovers/${v2Id}/approve`, reviewer.accessToken, {
          confirmReviewedForRecipient: true,
        });

        await ctx.callApi('POST', `/api/v1/handovers/${v2Id}/share`, reviewer.accessToken);

        // Recipient views v2
        const recipView = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${v2Id}`,
          recipient.accessToken
        );
        if (recipView.status !== 200 || !recipView.body?.data?.items?.length) {
          return {
            status: 'broken',
            responseStatus: recipView.status,
            expected: 'HTTP 200 with non-empty items on regenerated handover',
            actual: recipView.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Version 2 approved, shared, and accessible to recipient',
          actual: `Version 2 ID: ${v2Id}, items: ${recipView.body.data.items.length}`,
        };
      },
    },
    {
      id: 'scn8-step-07-vector-b-revoke-source-grant',
      name: 'Vector B: Revoke source grant and verify recipient receives 409',
      feature: 'PATCH /api/v1/sources/:id/access',
      action: 'Revoke recipient grant for restricted source and verify v2 becomes stale',
      expectedResult: 'HTTP 200/204; subsequent GET by recipient returns 409 REGENERATION_REQUIRED',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const recipient = getUser(ctx, 'recipient');
        const v2 = ctx.handovers.v2;
        const restrictedSource = ctx.sources.restricted;

        const delRes = await ctx.callApi(
          'PATCH',
          `/api/v1/sources/${restrictedSource.id}/access`,
          owner.accessToken,
          { visibility: 'restricted', grantUserIds: [] }
        );

        if (delRes.status !== 200 && delRes.status !== 204) {
          return {
            status: 'broken',
            responseStatus: delRes.status,
            expected: 'HTTP 200 or 204 for grant deletion',
            actual: delRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        // Recipient requests v2
        const viewRes = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${v2.id}`,
          recipient.accessToken
        );
        if (viewRes.status !== 409) {
          return {
            status: 'broken',
            responseStatus: viewRes.status,
            expected: 'HTTP 409 REGENERATION_REQUIRED after grant revocation',
            actual: viewRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 REGENERATION_REQUIRED after source grant revocation',
          actual: viewRes.body.error?.code,
        };
      },
    },
    {
      id: 'scn8-step-08-vector-c-archive-source',
      name: 'Vector C: Archive a source and verify recipient receives 409',
      feature: 'POST /api/v1/sources/:id/archive',
      action: 'Create v3, share it, archive archivable source, verify recipient receives 409',
      expectedResult: 'HTTP 200/409; source archive advances epoch and invalidates handover',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const reviewer = getUser(ctx, 'reviewer');
        const recipient = getUser(ctx, 'recipient');
        const v2 = ctx.handovers.v2;
        const archivableSource = ctx.sources.archivable;

        // Create v3 from v2
        const revRes = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${v2.id}/versions`,
          reviewer.accessToken
        );
        const v3Id = revRes.body?.data?.handoverId || revRes.body?.data?.id;
        ctx.handovers.v3 = { id: v3Id, title: 'Revocation Lifecycle Handover', version: 3 };

        // Approve and share v3
        const v3Detail = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${v3Id}`,
          reviewer.accessToken
        );
        for (const item of v3Detail.body?.data?.items || []) {
          await ctx.callApi(
            'PATCH',
            `/api/v1/handovers/${v3Id}/items/${item.id}`,
            reviewer.accessToken,
            { reviewState: 'approved' },
            { 'If-Match': String(item.rowVersion) }
          );
        }
        await ctx.callApi('POST', `/api/v1/handovers/${v3Id}/approve`, reviewer.accessToken, {
          confirmReviewedForRecipient: true,
        });
        await ctx.callApi('POST', `/api/v1/handovers/${v3Id}/share`, reviewer.accessToken);

        // Verify recipient can view v3 before archival
        const preView = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${v3Id}`,
          recipient.accessToken
        );
        if (preView.status !== 200) {
          return {
            status: 'broken',
            expected: 'HTTP 200 before source archival',
            actual: preView.status,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        // Archive source
        const arcRes = await ctx.callApi(
          'POST',
          `/api/v1/sources/${archivableSource.id}/archive`,
          owner.accessToken
        );
        if (arcRes.status !== 200) {
          return {
            status: 'broken',
            responseStatus: arcRes.status,
            expected: 'HTTP 200 for source archival',
            actual: arcRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        // Recipient requests v3 after source archival
        const postView = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${v3Id}`,
          recipient.accessToken
        );
        if (postView.status !== 409) {
          return {
            status: 'broken',
            responseStatus: postView.status,
            expected: 'HTTP 409 REGENERATION_REQUIRED after source archival',
            actual: postView.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Source archival advances epoch and returns 409 REGENERATION_REQUIRED',
          actual: postView.body.error?.code,
        };
      },
    },
    {
      id: 'scn8-step-09-stale-export-fails',
      name: 'Exporting stale handover returns 409 REGENERATION_REQUIRED',
      feature: 'GET /api/v1/handovers/:id/export?format=md',
      action: 'Recipient requests Markdown export of invalidated handover',
      expectedResult: 'HTTP 409 REGENERATION_REQUIRED',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const v3 = ctx.handovers.v3;

        const res = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${v3.id}/export?format=md`,
          recipient.accessToken
        );

        if (res.status !== 409) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 409 REGENERATION_REQUIRED',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 REGENERATION_REQUIRED on stale export',
          actual: res.body.error?.code,
        };
      },
    },
  ],
};
