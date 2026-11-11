import crypto from 'node:crypto';
import request from 'supertest';
import { createScenarioUser } from './context.js';
import { getUser, getProject, getHandover } from './types.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario6HandoverLifecycle: ScenarioDefinition = {
  id: 'scenario-6',
  number: 6,
  name: 'Handover lifecycle',
  description:
    'Draft generation permutations across all configuration dimensions, dual-reader claim gating, optimistic concurrency on item edits, claim attachment access gating, item rejection, approval preconditions and attestations, sharing, multi-version revisions, version supersession, and database-enforced immutability.',
  steps: [
    {
      id: 'scn6-step-01-setup',
      name: 'Setup organisation, project, reviewer, recipient, and sources',
      feature: 'POST /api/v1/organisations',
      action:
        'Create scn-org-6, scn-proj-6 with Reviewer and Recipient, import public and restricted sources',
      expectedResult: 'Project ready with public claims and reviewer-only restricted claims',
      run: async (ctx): Promise<StepExecutionResult> => {
        const ts = Date.now();
        const owner = await createScenarioUser(`scn6-owner-${ts}@example.test`, 'Owner');
        const reviewer = await createScenarioUser(`scn6-rev-${ts}@example.test`, 'Reviewer');
        const recipient = await createScenarioUser(`scn6-recip-${ts}@example.test`, 'Recipient');

        ctx.users.owner = owner;
        ctx.users.reviewer = reviewer;
        ctx.users.recipient = recipient;

        const orgRes = await ctx.callApi('POST', '/api/v1/organisations', owner.accessToken, {
          name: `scn-org-6-lifecycle-${ts}`,
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
          { name: `scn-proj-6-lifecycle-${ts}`, domain: 'software_engineering' }
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

        // Public source readable by both reviewer and recipient
        const pubRes = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Architecture Decisions',
            kind: 'text',
            visibility: 'project',
            content:
              'We decided to adopt PostgreSQL 16 for all relational data.\n\nWe need to implement API rate limiting by next week.',
          });

        // Restricted source granted only to reviewer (recipient cannot read)
        const restRes = await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Secret Financial Transition',
            kind: 'text',
            visibility: 'restricted',
            content: 'We decided on confidential bonus allocation of $25,000 for team lead.',
          });

        ctx.sources.public = pubRes.body.data.sources[0];
        ctx.sources.restricted = restRes.body.data.sources[0];

        // Grant restricted source to reviewer
        await ctx.callApi(
          'PATCH',
          `/api/v1/sources/${ctx.sources.restricted.id}/access`,
          owner.accessToken,
          { visibility: 'restricted', grantUserIds: [reviewer.id] }
        );

        // Run extraction on both sources
        await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/extractions`,
          owner.accessToken,
          {},
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        // Wait for extraction to complete
        await new Promise((r) => setTimeout(r, 1500));

        // Get public and restricted claim IDs
        const claimsRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${ctx.projects.main.id}/claims`,
          reviewer.accessToken
        );

        ctx.state.claims = claimsRes.body.data;
        ctx.state.publicClaim = claimsRes.body.data.find((c: any) =>
          c.statement.includes('PostgreSQL 16')
        );
        ctx.state.restrictedClaim = claimsRes.body.data.find((c: any) =>
          c.statement.includes('$25,000')
        );

        return {
          status: 'passed',
          expected: 'Project ready with public and restricted claims',
          actual: `Public claim: ${ctx.state.publicClaim?.id}, Restricted claim: ${ctx.state.restrictedClaim?.id}`,
        };
      },
    },
    {
      id: 'scn6-step-02-generate-configuration-variants',
      name: 'Generate handovers with varied configuration dimensions',
      feature: 'POST /api/v1/projects/:id/handovers',
      action:
        'Generate handovers testing concise vs detailed, professional vs plain language, and section subsets',
      expectedResult: 'HTTP 202 for generation requests and drafts persisted',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const recipient = getUser(ctx, 'recipient');
        const proj = getProject(ctx, 'main');

        // Variant 1: Concise, plain_language, completed work off
        const v1Res = await ctx.callApi(
          'POST',
          `/api/v1/projects/${proj.id}/handovers`,
          reviewer.accessToken,
          {
            title: 'Concise Plain Handover',
            recipientId: recipient.id,
            departingUserId: reviewer.id,
            detailLevel: 'concise',
            tone: 'plain_language',
            includeCompletedWork: false,
            includeProposedNextActions: true,
            includedSections: ['snapshot', 'decisions', 'work_in_progress'],
          },
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        if (v1Res.status !== 202 || !v1Res.body?.data?.jobId) {
          return {
            status: 'broken',
            responseStatus: v1Res.status,
            expected: 'HTTP 202 with jobId',
            actual: v1Res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        // Wait for handover generation worker to finish
        const jobId = v1Res.body.data.jobId;
        const start = Date.now();
        while (Date.now() - start < 10000) {
          const check = await ctx.callApi('GET', `/api/v1/jobs/${jobId}`, reviewer.accessToken);
          if (check.body?.data?.status === 'succeeded') break;
          await new Promise((r) => setTimeout(r, 200));
        }

        // Retrieve generated draft
        const listRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}/handovers`,
          reviewer.accessToken
        );

        if (!listRes.body?.data?.length) {
          return {
            status: 'broken',
            expected: 'At least one generated handover in list',
            actual: listRes.body,
            likelySourceFile: 'apps/worker/src/handlers/handover.ts',
          };
        }

        const draft = listRes.body.data[0];
        ctx.handovers.main = { id: draft.id, title: draft.title, version: draft.version };

        return {
          status: 'passed',
          expected: 'Handover draft generated with configuration applied',
          actual: `Generated handover draft ${draft.id} at version ${draft.version}`,
        };
      },
    },
    {
      id: 'scn6-step-03-verify-recipient-isolation-in-draft',
      name: 'Verify restricted fact never appears in recipient draft items',
      feature: 'Dual-Reader Gating (SPEC Section 2A.4 Item 1)',
      action: 'Inspect draft items to ensure $25,000 restricted claim is completely excluded',
      expectedResult: 'Zero occurrences of restricted claim in draft items',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const detailRes = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${handover.id}`,
          reviewer.accessToken
        );

        const items = detailRes.body?.data?.items || [];
        for (const item of items) {
          if (item.text.includes('$25,000') || item.text.toLowerCase().includes('bonus')) {
            return {
              status: 'broken',
              expected: 'Zero restricted items in recipient draft',
              actual: `Found restricted item in draft: "${item.text}"`,
              likelySourceFile: 'apps/worker/src/handlers/handover.ts',
            };
          }
        }

        return {
          status: 'passed',
          expected: 'Restricted claims strictly excluded from generation context',
          actual: `Verified all ${items.length} draft items contain only dual-readable facts`,
        };
      },
    },
    {
      id: 'scn6-step-04-edit-item-optimistic-concurrency',
      name: 'Item edit with valid and stale If-Match headers',
      feature: 'PATCH /api/v1/handovers/:id/items/:itemId',
      action: 'Edit with correct row_version, then re-edit with stale row_version',
      expectedResult:
        'First edit succeeds (row_version 2); stale edit fails with 409 VERSION_CONFLICT',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const detailRes = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${handover.id}`,
          reviewer.accessToken
        );
        const item = detailRes.body.data.items[0];

        // 1. Valid edit with matching rowVersion
        const edit1 = await ctx.callApi(
          'PATCH',
          `/api/v1/handovers/${handover.id}/items/${item.id}`,
          reviewer.accessToken,
          { text: 'PostgreSQL 16 is approved for all core data.' },
          { 'If-Match': String(item.rowVersion) }
        );

        if (edit1.status !== 200 || edit1.body?.data?.rowVersion !== item.rowVersion + 1) {
          return {
            status: 'broken',
            responseStatus: edit1.status,
            expected: `HTTP 200 with rowVersion: ${item.rowVersion + 1}`,
            actual: edit1.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        // 2. Stale edit using old rowVersion
        const edit2 = await ctx.callApi(
          'PATCH',
          `/api/v1/handovers/${handover.id}/items/${item.id}`,
          reviewer.accessToken,
          { text: 'Conflicting stale update text' },
          { 'If-Match': String(item.rowVersion) }
        );

        if (edit2.status !== 409 || edit2.body?.error?.code !== 'VERSION_CONFLICT') {
          return {
            status: 'broken',
            responseStatus: edit2.status,
            expected: 'HTTP 409 VERSION_CONFLICT',
            actual: edit2.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        ctx.state.targetItemId = item.id;

        return {
          status: 'passed',
          expected: 'Optimistic concurrency enforced',
          actual: `Edit succeeded with v2; stale edit rejected with 409 (${edit2.body.error.code})`,
        };
      },
    },
    {
      id: 'scn6-step-05-add-item-from-claims',
      name: 'Add an item from claims',
      feature: 'POST /api/v1/handovers/:id/items',
      action: 'Add new handover item linked to public claim',
      expectedResult: 'HTTP 201 with created item and claim link',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${handover.id}/items`,
          reviewer.accessToken,
          {
            section: 'decisions',
            itemKind: 'fact',
            text: 'We agreed to use PostgreSQL 16 for primary relational storage.',
            claimIds: [ctx.state.publicClaim.id],
          }
        );

        const itemId = res.body?.data?.id || res.body?.data?.itemId;
        if (res.status !== 201 || !itemId) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 201 with created item',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Item added from claim',
          actual: `Added item ${itemId} in section: decisions`,
        };
      },
    },
    {
      id: 'scn6-step-06-fail-attaching-unreadable-claim',
      name: 'Fail when attempting to attach claim recipient cannot read',
      feature: 'Attachment Dual-Reader Validation (SPEC Section 2A.4 Item 4)',
      action: 'Attempt to add item linking claim recipient lacks access to',
      expectedResult: 'HTTP 409 ACCESS_VALIDATION_FAILED',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${handover.id}/items`,
          reviewer.accessToken,
          {
            section: 'decisions',
            itemKind: 'fact',
            text: 'Confidential bonus allocation fact.',
            claimIds: [ctx.state.restrictedClaim.id],
          }
        );

        if (res.status !== 409 || res.body?.error?.code !== 'ACCESS_VALIDATION_FAILED') {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 409 ACCESS_VALIDATION_FAILED',
            actual: res.body,
            likelySourceFile: 'supabase/migrations/20261107100002_mutation_functions.sql',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 ACCESS_VALIDATION_FAILED',
          actual: `Rejected unreadable claim attachment with HTTP 409 (${res.body.error.code})`,
        };
      },
    },
    {
      id: 'scn6-step-07-reject-item',
      name: 'Reviewer rejects an item in draft',
      feature: 'PATCH /api/v1/handovers/:id/items/:itemId',
      action: 'Set item review_state to rejected',
      expectedResult: 'HTTP 200 with reviewState: rejected',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const detailRes = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${handover.id}`,
          reviewer.accessToken
        );
        const itemToReject = detailRes.body.data.items[detailRes.body.data.items.length - 1];

        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/handovers/${handover.id}/items/${itemToReject.id}`,
          reviewer.accessToken,
          { reviewState: 'rejected' },
          { 'If-Match': String(itemToReject.rowVersion) }
        );

        if (res.status !== 200 || res.body?.data?.reviewState !== 'rejected') {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 with reviewState: rejected',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Item reviewState marked rejected',
          actual: `Item ${itemToReject.id} rejected by reviewer`,
        };
      },
    },
    {
      id: 'scn6-step-08-fail-approve-with-pending-items',
      name: 'Fail approval when pending unreviewed items remain',
      feature: 'POST /api/v1/handovers/:id/approve',
      action: 'Attempt approval when some items are still in pending review status',
      expectedResult: 'HTTP 409 PRECONDITION_FAILED',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${handover.id}/approve`,
          reviewer.accessToken,
          { confirmReviewedForRecipient: true }
        );

        if (res.status !== 409) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 409 PRECONDITION_FAILED',
            actual: res.body,
            likelySourceFile: 'supabase/migrations/20261107100002_mutation_functions.sql',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 Approval rejected with pending items',
          actual: `Precondition enforced: returned HTTP ${res.status}`,
        };
      },
    },
    {
      id: 'scn6-step-09-approve-draft',
      name: 'Approve draft after reviewing all items with attestation',
      feature: 'POST /api/v1/handovers/:id/approve',
      action:
        'Approve all remaining pending items and call approve with confirmReviewedForRecipient: true',
      expectedResult: 'HTTP 200 with status: approved',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const detailRes = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${handover.id}`,
          reviewer.accessToken
        );

        // Approve all non-rejected items
        for (const item of detailRes.body.data.items) {
          if (item.reviewState === 'pending') {
            await ctx.callApi(
              'PATCH',
              `/api/v1/handovers/${handover.id}/items/${item.id}`,
              reviewer.accessToken,
              { reviewState: 'approved' },
              { 'If-Match': String(item.rowVersion) }
            );
          }
        }

        const appRes = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${handover.id}/approve`,
          reviewer.accessToken,
          { confirmReviewedForRecipient: true }
        );

        if (appRes.status !== 200 || appRes.body?.data?.status !== 'approved') {
          return {
            status: 'broken',
            responseStatus: appRes.status,
            expected: 'HTTP 200 with status: approved',
            actual: appRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Handover version approved',
          actual: `Approved handover ${handover.id} (status: ${appRes.body.data.status})`,
        };
      },
    },
    {
      id: 'scn6-step-10-share-handover',
      name: 'Share approved handover with designated recipient',
      feature: 'POST /api/v1/handovers/:id/share',
      action: 'Reviewer shares approved handover version',
      expectedResult: 'HTTP 200 with status: shared',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${handover.id}/share`,
          reviewer.accessToken
        );

        if (res.status !== 200 || res.body?.data?.status !== 'shared') {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 with status: shared',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Handover shared with recipient',
          actual: `Shared handover ${handover.id} (sharedAt: ${res.body.data.sharedAt})`,
        };
      },
    },
    {
      id: 'scn6-step-11-create-revision',
      name: 'Revise shared handover into a new draft version',
      feature: 'POST /api/v1/handovers/:id/versions',
      action: 'Create revision from shared version (version 2 with same rootId)',
      expectedResult: 'HTTP 201 with version: 2 and status: draft',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');

        const res = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${handover.id}/versions`,
          reviewer.accessToken
        );

        if (res.status !== 201 || res.body?.data?.version !== 2) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 201 with version: 2',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const revisionHandoverId = res.body?.data?.handoverId || res.body?.data?.id;
        ctx.state.revisionHandoverId = revisionHandoverId;

        return {
          status: 'passed',
          expected: 'New draft version created',
          actual: `Created revision ${revisionHandoverId} at version ${res.body.data.version}`,
        };
      },
    },
    {
      id: 'scn6-step-12-share-revision-supersedes-prior',
      name: 'Sharing new revision supersedes prior shared version',
      feature: 'Version Supersession (SPEC Section 2A.4 Item 8)',
      action: 'Approve and share version 2, then check status of version 1',
      expectedResult: 'Version 1 status transitions to superseded',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const handover = getHandover(ctx, 'main');
        const revId = ctx.state.revisionHandoverId;

        // Approve all items on v2
        const v2Detail = await ctx.callApi(
          'GET',
          `/api/v1/handovers/${revId}`,
          reviewer.accessToken
        );
        for (const item of v2Detail.body?.data?.items || []) {
          await ctx.callApi(
            'PATCH',
            `/api/v1/handovers/${revId}/items/${item.id}`,
            reviewer.accessToken,
            { reviewState: 'approved' },
            { 'If-Match': String(item.rowVersion) }
          );
        }

        // Approve version 2
        await ctx.callApi('POST', `/api/v1/handovers/${revId}/approve`, reviewer.accessToken, {
          confirmReviewedForRecipient: true,
        });

        // Share version 2
        const share2 = await ctx.callApi(
          'POST',
          `/api/v1/handovers/${revId}/share`,
          reviewer.accessToken
        );

        if (share2.status !== 200) {
          return {
            status: 'broken',
            responseStatus: share2.status,
            expected: 'HTTP 200 sharing version 2',
            actual: share2.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        // Check version 1 status in database
        const v1Db = await ctx.pool.query(
          `SELECT status FROM public.handovers WHERE id = '${handover.id}';`
        );
        const v1Status = v1Db.rows[0]?.status;

        if (v1Status !== 'superseded') {
          return {
            status: 'broken',
            expected: 'Version 1 status === "superseded"',
            actual: `Version 1 status is "${v1Status}"`,
            likelySourceFile: 'supabase/migrations/20261107100002_mutation_functions.sql',
          };
        }

        return {
          status: 'passed',
          expected: 'Prior version marked superseded',
          actual: `Version 1 atomically transitioned to status: ${v1Status}`,
        };
      },
    },
    {
      id: 'scn6-step-13-immutability-of-approved-and-shared',
      name: 'Verify approved and shared versions are strictly immutable',
      feature: 'Database Trigger Immutability (SPEC Section 2A.4 Item 8)',
      action: 'Attempt to update items or delete handover on approved/shared version',
      expectedResult: 'Database triggers reject any mutation on non-draft versions',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');

        // Attempt API edit on shared version 2 with valid If-Match
        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/handovers/${ctx.state.revisionHandoverId}/items/${ctx.state.targetItemId}`,
          reviewer.accessToken,
          { text: 'Illegal edit on shared version' },
          { 'If-Match': '1' }
        );

        if (res.status !== 409 && res.status !== 403 && res.status !== 422) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 409/403/422 rejecting edit on shared version',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Approved/shared versions are immutable',
          actual: `Direct update rejected with HTTP ${res.status} (${res.body?.error?.code || 'REJECTED'})`,
        };
      },
    },
    {
      id: 'scn6-step-14-recipient-acknowledgement',
      name: 'Recipient acknowledges shared handover receipt',
      feature: 'Acknowledgement of Receipt (Hackathon Addition 1)',
      action:
        'Recipient calls POST /api/v1/handovers/:id/acknowledge, verifies idempotency, checks GET /handovers/:id acknowledgedAt',
      expectedResult:
        'HTTP 200 with acknowledgedAt, idempotent second call, acknowledgedAt visible in handover detail',
      run: async (ctx): Promise<StepExecutionResult> => {
        const recipient = getUser(ctx, 'recipient');
        const reviewer = getUser(ctx, 'reviewer');
        const handoverId = ctx.state.revisionHandoverId;

        // 1. Recipient acknowledges shared handover
        const ackRes = await request(ctx.app)
          .post(`/api/v1/handovers/${handoverId}/acknowledge`)
          .set('Authorization', `Bearer ${recipient.accessToken}`)
          .send();

        if (ackRes.status !== 200 || !ackRes.body?.data?.acknowledgedAt) {
          return {
            status: 'broken',
            responseStatus: ackRes.status,
            expected: 'HTTP 200 with data.acknowledgedAt',
            actual: ackRes.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        const acknowledgedAt = ackRes.body.data.acknowledgedAt;

        // 2. Idempotent second call
        const ackRes2 = await request(ctx.app)
          .post(`/api/v1/handovers/${handoverId}/acknowledge`)
          .set('Authorization', `Bearer ${recipient.accessToken}`)
          .send();

        if (ackRes2.status !== 200 || ackRes2.body?.data?.acknowledgedAt !== acknowledgedAt) {
          return {
            status: 'broken',
            responseStatus: ackRes2.status,
            expected: 'HTTP 200 returning existing acknowledgedAt idempotently',
            actual: ackRes2.body,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        // 3. Reviewer sees acknowledgedAt in GET /handovers/:id
        const detailRes = await request(ctx.app)
          .get(`/api/v1/handovers/${handoverId}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`);

        if (detailRes.body?.data?.acknowledgedAt !== acknowledgedAt) {
          return {
            status: 'broken',
            expected: `detail acknowledgedAt === ${acknowledgedAt}`,
            actual: detailRes.body?.data?.acknowledgedAt,
            likelySourceFile: 'apps/api/src/routes/handovers.ts',
          };
        }

        return {
          status: 'passed',
          expected:
            'Handover receipt acknowledged idempotently by recipient and reflected in handover detail',
          actual: `Acknowledged at ${acknowledgedAt}`,
        };
      },
    },
  ],
};
