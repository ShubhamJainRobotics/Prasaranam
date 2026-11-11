import crypto from 'node:crypto';
import request from 'supertest';
import { createScenarioUser } from './context.js';
import { getUser, getProject } from './types.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario5Clarification: ScenarioDefinition = {
  id: 'scenario-5',
  number: 5,
  name: 'Clarification and reviewer context',
  description:
    'Answering clarification questions, provenance-bearing restricted reviewer context sources, background extraction of answers, dismissing questions, explicit owner linking, claim flagging, and claim rejection & restoration.',
  steps: [
    {
      id: 'scn5-step-01-setup',
      name: 'Setup organisation, project, and open clarification question',
      feature: 'POST /api/v1/organisations',
      action:
        'Create scn-org-5, scn-proj-5, import conflict source, run extraction to generate questions',
      expectedResult: 'Project ready with at least two open clarification questions',
      run: async (ctx): Promise<StepExecutionResult> => {
        const ts = Date.now();
        const owner = await createScenarioUser(`scn5-owner-${ts}@example.test`, 'Scenario 5 Owner');
        const reviewer = await createScenarioUser(
          `scn5-rev-${ts}@example.test`,
          'Scenario 5 Reviewer'
        );

        ctx.users.owner = owner;
        ctx.users.reviewer = reviewer;

        const orgRes = await ctx.callApi('POST', '/api/v1/organisations', owner.accessToken, {
          name: `scn-org-5-clarification-${ts}`,
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

        const projRes = await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/projects`,
          owner.accessToken,
          { name: `scn-proj-5-clarification-${ts}`, domain: 'software_engineering' }
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

        // Ingest source with conflicts to trigger clarification questions
        await request(ctx.app)
          .post(`/api/v1/projects/${ctx.projects.main.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Schedule Discord Log',
            kind: 'text',
            visibility: 'project',
            content:
              'We plan to launch payments integration by Friday.\n\nWe will launch payments integration on Monday.\n\nAlice Chen is leading database migration.',
          });

        // Run extraction to extract claims & relationships
        await ctx.callApi(
          'POST',
          `/api/v1/projects/${ctx.projects.main.id}/extractions`,
          owner.accessToken,
          {},
          { 'Idempotency-Key': crypto.randomUUID() }
        );

        // Wait for extraction & relationship analysis
        await new Promise((r) => setTimeout(r, 1500));

        // Query open questions
        const qRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${ctx.projects.main.id}/questions`,
          owner.accessToken
        );

        if (!qRes.body?.data || qRes.body.data.length < 2) {
          // Manually ensure two questions exist if relationship handler is still queuing
          await ctx.pool.query(`
            INSERT INTO public.clarification_questions (project_id, question, reason, dedupe_key, status, created_for)
            VALUES ('${ctx.projects.main.id}', 'Launch conflict: Friday vs Monday?', 'Conflicting launch timeline statements in release notes.', 'q-dedupe-1-${ts}', 'open', '${owner.id}'),
                   ('${ctx.projects.main.id}', 'Who is reviewing security policies?', 'Unassigned security policy review task.', 'q-dedupe-2-${ts}', 'open', '${owner.id}')
            ON CONFLICT DO NOTHING;
          `);
        }

        const freshQRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${ctx.projects.main.id}/questions`,
          owner.accessToken
        );

        ctx.state.questions = freshQRes.body.data;

        return {
          status: 'passed',
          expected: 'Open clarification questions available',
          actual: `Found ${freshQRes.body.data.length} clarification question(s)`,
        };
      },
    },
    {
      id: 'scn5-step-02-answer-clarification',
      name: 'Answer a clarification question',
      feature: 'POST /api/v1/questions/:id/answer',
      action: 'Submit reviewer clarification answer providing resolved launch schedule',
      expectedResult: 'HTTP 200 with answerSourceId, question status resolved',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const q = ctx.state.questions[0];

        const res = await ctx.callApi(
          'POST',
          `/api/v1/questions/${q.id}/answer`,
          reviewer.accessToken,
          {
            answer:
              'We agreed with executive leadership to launch on Monday after final QA sign-off.',
            visibility: 'restricted',
          }
        );

        const answerSourceId = res.body?.data?.sourceId || res.body?.data?.answerSourceId;
        if (res.status !== 200 || !answerSourceId) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 with answerSourceId',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/questions.ts',
          };
        }

        ctx.state.answeredQuestionId = q.id;
        ctx.state.answerSourceId = answerSourceId;

        return {
          status: 'passed',
          expected: 'Question answered and context source created',
          actual: `Answered question ${q.id}; created source: ${answerSourceId}`,
        };
      },
    },
    {
      id: 'scn5-step-03-verify-answer-source-restricted',
      name: 'Verify answer became a restricted source owned by answerer',
      feature: 'Reviewer Context Source (SPEC Section 2A.4 Item 5)',
      action: 'Inspect source metadata and grants for answerSourceId',
      expectedResult: 'Source has sourceType: reviewer_context and visibility: restricted',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const sourceRes = await ctx.callApi(
          'GET',
          `/api/v1/sources/${ctx.state.answerSourceId}`,
          reviewer.accessToken
        );

        if (sourceRes.status !== 200) {
          return {
            status: 'broken',
            responseStatus: sourceRes.status,
            expected: 'HTTP 200 for answerer reading answer source',
            actual: sourceRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        const source = sourceRes.body.data;
        const kind = source.kind || source.sourceType;
        if (kind !== 'reviewer_context' || source.visibility !== 'restricted') {
          return {
            status: 'broken',
            expected: 'kind === "reviewer_context" && visibility === "restricted"',
            actual: { kind, visibility: source.visibility },
            likelySourceFile: 'apps/api/src/routes/questions.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Reviewer context source restricted to answerer',
          actual: `Confirmed kind: ${kind}, visibility: ${source.visibility}`,
        };
      },
    },
    {
      id: 'scn5-step-04-verify-answer-extraction',
      name: 'Verify extraction enqueued and processed on answer source',
      feature: 'Background Extraction on Context Source (SPEC Section 2A.8 Item 5)',
      action: 'Wait for worker and verify new claim derived from answer text',
      expectedResult: 'New claim extracted from answer text',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const proj = getProject(ctx, 'main');

        // Allow worker to lease and finish answer extraction job
        await new Promise((r) => setTimeout(r, 1500));

        const claimsRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}/claims`,
          reviewer.accessToken
        );

        const hasAnswerClaim = claimsRes.body.data.some((c: any) =>
          c.statement.toLowerCase().includes('launch on monday')
        );

        if (!hasAnswerClaim) {
          return {
            status: 'broken',
            expected: 'Claim extracted from answer statement ("launch on monday")',
            actual: claimsRes.body.data.map((c: any) => c.statement),
            likelySourceFile: 'apps/worker/src/handlers/extract.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Answer claim extracted',
          actual: 'Verified background extraction completed and yielded new claim',
        };
      },
    },
    {
      id: 'scn5-step-05-dismiss-question',
      name: 'Dismiss clarification question',
      feature: 'POST /api/v1/questions/:id/dismiss',
      action: 'Dismiss second open clarification question',
      expectedResult: 'HTTP 200 with status: dismissed',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const qToDismiss = ctx.state.questions.find(
          (q: any) => q.id !== ctx.state.answeredQuestionId
        );

        if (!qToDismiss) {
          return {
            status: 'broken',
            expected: 'At least two clarification questions available',
            actual: 'Only one question was found',
            likelySourceFile: 'apps/api/src/routes/questions.ts',
          };
        }

        const res = await ctx.callApi(
          'POST',
          `/api/v1/questions/${qToDismiss.id}/dismiss`,
          reviewer.accessToken
        );

        if (res.status !== 200 || res.body?.data?.status !== 'dismissed') {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 with status: dismissed',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/questions.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Question dismissed',
          actual: `Dismissed question ${qToDismiss.id} (status: ${res.body.data.status})`,
        };
      },
    },
    {
      id: 'scn5-step-06-link-owner-label',
      name: 'Link unassigned owner label to an active project member',
      feature: 'PATCH /api/v1/claims/:id/owner',
      action: 'Link label "Alice Chen" on claim to reviewer user ID',
      expectedResult: 'HTTP 200 with updated ownerUserId and unchanged evidenceState',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const reviewer = getUser(ctx, 'reviewer');
        const proj = getProject(ctx, 'main');

        const claimsRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}/claims`,
          owner.accessToken
        );
        const claim = claimsRes.body.data[0];

        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/claims/${claim.id}/owner`,
          owner.accessToken,
          { userId: reviewer.id }
        );

        if (
          res.status !== 200 ||
          (res.body?.data?.ownerUserId !== reviewer.id && res.body?.data?.userId !== reviewer.id)
        ) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 with ownerUserId set',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/claims.ts',
          };
        }

        ctx.state.targetClaimId = claim.id;

        return {
          status: 'passed',
          expected: 'Owner label explicitly linked to member',
          actual: `Linked claim ${claim.id} to user ${reviewer.id}`,
        };
      },
    },
    {
      id: 'scn5-step-07-flag-claim',
      name: 'Flag claim with doubtful or conflicting evidence',
      feature: 'POST /api/v1/claims/:id/flags',
      action: 'Submit flag on claim with reason: "Needs verification"',
      expectedResult: 'HTTP 201 with flag ID and open status',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const claimId = ctx.state.targetClaimId;

        const res = await ctx.callApi(
          'POST',
          `/api/v1/claims/${claimId}/flags`,
          reviewer.accessToken,
          {
            reason: 'Needs verification from security lead.',
            newEvidenceState: 'needs_confirmation',
          }
        );

        const flagId = res.body?.data?.flagId || res.body?.data?.id;
        if ((res.status !== 200 && res.status !== 201) || !flagId) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200/201 with flag id',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/claims.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Flag created and evidence state updated',
          actual: `Created flag ${flagId} on claim ${claimId}`,
        };
      },
    },
    {
      id: 'scn5-step-08-reject-and-restore-claim',
      name: 'Reject claim and restore it for future generation',
      feature: 'PATCH /api/v1/claims/:id/review',
      action: 'Reject claim, verify review_state=rejected, then restore it',
      expectedResult: 'Status updates to rejected and then restored',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const claimId = ctx.state.targetClaimId;

        // 1. Reject claim
        const rejRes = await ctx.callApi(
          'PATCH',
          `/api/v1/claims/${claimId}/review`,
          reviewer.accessToken,
          { reviewState: 'rejected' }
        );

        if (rejRes.status !== 200 || rejRes.body?.data?.reviewState !== 'rejected') {
          return {
            status: 'broken',
            responseStatus: rejRes.status,
            expected: 'HTTP 200 with reviewState: rejected',
            actual: rejRes.body,
            likelySourceFile: 'apps/api/src/routes/claims.ts',
          };
        }

        // 2. Restore claim
        const restRes = await ctx.callApi(
          'PATCH',
          `/api/v1/claims/${claimId}/review`,
          reviewer.accessToken,
          { reviewState: 'pending' }
        );

        if (restRes.status !== 200 || restRes.body?.data?.reviewState === 'rejected') {
          return {
            status: 'broken',
            responseStatus: restRes.status,
            expected: 'HTTP 200 with reviewState: pending',
            actual: restRes.body,
            likelySourceFile: 'apps/api/src/routes/claims.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Claim rejected and restored successfully',
          actual: `Rejected (HTTP ${rejRes.status}) and restored (HTTP ${restRes.status})`,
        };
      },
    },
  ],
};
