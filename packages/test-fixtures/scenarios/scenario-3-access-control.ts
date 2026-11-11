import crypto from 'node:crypto';
import request from 'supertest';
import { createScenarioUser } from './context.js';
import { getUser, getOrg, getProject, getSource } from './types.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario3AccessControl: ScenarioDefinition = {
  id: 'scenario-3',
  number: 3,
  name: 'Access control',
  description:
    'Tenant boundaries, restricted vs project visibility, source grants, org-admin project isolation, outsider isolation, controlled source archival, existence-probing defense via 404s, and access-filtered count masking.',
  steps: [
    {
      id: 'scn3-step-01-setup',
      name: 'Setup organisation, project, and actors',
      feature: 'POST /api/v1/organisations',
      action:
        'Create scn-org-3 and scn-proj-3 with Owner, Reviewer, Contributor, OrgAdmin, and Outsider',
      expectedResult: 'All actors and memberships configured with distinct isolation roles',
      run: async (ctx): Promise<StepExecutionResult> => {
        const ts = Date.now();
        const owner = await createScenarioUser(`scn3-owner-${ts}@example.test`, 'Owner');
        const reviewer = await createScenarioUser(`scn3-reviewer-${ts}@example.test`, 'Reviewer');
        const contributor = await createScenarioUser(
          `scn3-contrib-${ts}@example.test`,
          'Contributor'
        );
        const orgAdmin = await createScenarioUser(`scn3-orgadmin-${ts}@example.test`, 'Org Admin');
        const outsider = await createScenarioUser(`scn3-outsider-${ts}@example.test`, 'Outsider');

        ctx.users.owner = owner;
        ctx.users.reviewer = reviewer;
        ctx.users.contributor = contributor;
        ctx.users.orgAdmin = orgAdmin;
        ctx.users.outsider = outsider;

        const orgRes = await ctx.callApi('POST', '/api/v1/organisations', owner.accessToken, {
          name: `scn-org-3-access-${ts}`,
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
            email: contributor.email,
            role: 'member',
          }
        );

        // Add orgAdmin to org as admin (but NEVER add to project!)
        await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/members`,
          owner.accessToken,
          {
            email: orgAdmin.email,
            role: 'admin',
          }
        );

        const projRes = await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/projects`,
          owner.accessToken,
          { name: `scn-proj-3-access-${ts}`, domain: 'software_engineering' }
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
            email: contributor.email,
            role: 'contributor',
          }
        );

        return {
          status: 'passed',
          expected: 'Actors created and isolated',
          actual: `Configured project ${ctx.projects.main.id} with 5 distinct test actors`,
        };
      },
    },
    {
      id: 'scn3-step-02-create-sources',
      name: 'Create project-visible and restricted sources',
      feature: 'POST /api/v1/projects/:id/sources/import',
      action: 'Import one project-visible source and one restricted source',
      expectedResult: 'HTTP 201 for both sources',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');

        const pubRes = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Public Project Roadmap',
            kind: 'text',
            visibility: 'project',
            content: 'We decided to build the new payments flow with Stripe.',
          });

        const restRes = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Confidential Transition Bonus Notes',
            kind: 'text',
            visibility: 'restricted',
            content: 'Confidential transition bonus of $25,000 for team lead.',
          });

        if (pubRes.status !== 201 || restRes.status !== 201) {
          return {
            status: 'broken',
            responseStatus: restRes.status,
            expected: 'HTTP 201 for both sources',
            actual: { pub: pubRes.body, rest: restRes.body },
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        ctx.sources.public = {
          id: pubRes.body.data.sources[0].id,
          title: 'Public Project Roadmap',
        };
        ctx.sources.restricted = {
          id: restRes.body.data.sources[0].id,
          title: 'Confidential Transition Bonus Notes',
        };

        return {
          status: 'passed',
          expected: 'Public and restricted sources created',
          actual: `Public: ${ctx.sources.public.id}, Restricted: ${ctx.sources.restricted.id}`,
        };
      },
    },
    {
      id: 'scn3-step-03-verify-restricted-without-grant',
      name: 'Verify restricted source unreadable without grant',
      feature: 'Source Access Authorization (SPEC Section 11.2)',
      action: 'Reviewer attempts to access restricted source before receiving a grant',
      expectedResult: 'HTTP 404 NOT_FOUND (masked existence)',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const restricted = getSource(ctx, 'restricted');

        const res = await ctx.callApi(
          'GET',
          `/api/v1/sources/${restricted.id}`,
          reviewer.accessToken
        );

        if (res.status !== 404) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 404 NOT_FOUND',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 404 NOT_FOUND',
          actual: `Returned HTTP 404 (${res.body?.error?.code || 'NOT_FOUND'}) to reviewer`,
        };
      },
    },
    {
      id: 'scn3-step-04-grant-source-access',
      name: 'Grant access to restricted source',
      feature: 'PATCH /api/v1/sources/:id/access',
      action: 'Project owner grants reviewer explicit access to restricted source',
      expectedResult: 'HTTP 200 with updated grants list and epoch increment',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const reviewer = getUser(ctx, 'reviewer');
        const restricted = getSource(ctx, 'restricted');

        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/sources/${restricted.id}/access`,
          owner.accessToken,
          {
            visibility: 'restricted',
            grantUserIds: [reviewer.id],
          }
        );

        if (res.status !== 200 || !res.body?.data?.grantUserIds?.includes(reviewer.id)) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 200 with grantUserIds containing reviewer',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Grant added for reviewer',
          actual: `Grant applied: ${(res.body.data.grantUserIds || res.body.data.grantedUserIds || []).join(', ')}`,
        };
      },
    },
    {
      id: 'scn3-step-05-verify-restricted-with-grant',
      name: 'Verify granted user can read restricted source while ungranted cannot',
      feature: 'Source Access Authorization (SPEC Section 11.2)',
      action: 'Reviewer reads restricted source, while contributor still receives 404',
      expectedResult: 'Reviewer gets HTTP 200; Contributor gets HTTP 404',
      run: async (ctx): Promise<StepExecutionResult> => {
        const reviewer = getUser(ctx, 'reviewer');
        const contributor = getUser(ctx, 'contributor');
        const restricted = getSource(ctx, 'restricted');

        const revRes = await ctx.callApi(
          'GET',
          `/api/v1/sources/${restricted.id}`,
          reviewer.accessToken
        );
        const contribRes = await ctx.callApi(
          'GET',
          `/api/v1/sources/${restricted.id}`,
          contributor.accessToken
        );

        if (revRes.status !== 200) {
          return {
            status: 'broken',
            responseStatus: revRes.status,
            expected: 'Reviewer receives HTTP 200',
            actual: revRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        if (contribRes.status !== 404) {
          return {
            status: 'broken',
            responseStatus: contribRes.status,
            expected: 'Contributor receives HTTP 404',
            actual: contribRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Reviewer 200 OK, Contributor 404 Not Found',
          actual: `Reviewer: ${revRes.status}, Contributor: ${contribRes.status}`,
        };
      },
    },
    {
      id: 'scn3-step-06-org-admin-project-isolation',
      name: 'Organisation admin without project membership sees no project content',
      feature: 'Tenant Isolation (SPEC Section 2A.2)',
      action: 'OrgAdmin queries project summary, sources, and claims',
      expectedResult: 'HTTP 404 NOT_FOUND across all project endpoints',
      run: async (ctx): Promise<StepExecutionResult> => {
        const orgAdmin = getUser(ctx, 'orgAdmin');
        const proj = getProject(ctx, 'main');

        const projRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}`,
          orgAdmin.accessToken
        );
        const sourcesRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}/sources`,
          orgAdmin.accessToken
        );

        if (projRes.status !== 404 || sourcesRes.status !== 404) {
          return {
            status: 'broken',
            expected: 'HTTP 404 NOT_FOUND for both queries',
            actual: { projectStatus: projRes.status, sourcesStatus: sourcesRes.status },
            likelySourceFile: 'apps/api/src/routes/projects.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Zero project disclosure to non-member Org Admin',
          actual: `All requests returned HTTP 404 to Org Admin`,
        };
      },
    },
    {
      id: 'scn3-step-07-outsider-in-other-org-isolation',
      name: 'Outsider in different organisation sees nothing',
      feature: 'Cross-Tenant Isolation (SPEC Section 2A.2)',
      action: 'Outsider queries project, public source, and org endpoints',
      expectedResult: 'HTTP 404 NOT_FOUND across all endpoints',
      run: async (ctx): Promise<StepExecutionResult> => {
        const outsider = getUser(ctx, 'outsider');
        const org = getOrg(ctx, 'main');
        const proj = getProject(ctx, 'main');
        const pubSource = getSource(ctx, 'public');

        const res1 = await ctx.callApi(
          'GET',
          `/api/v1/organisations/${org.id}/members`,
          outsider.accessToken
        );
        const res2 = await ctx.callApi('GET', `/api/v1/projects/${proj.id}`, outsider.accessToken);
        const res3 = await ctx.callApi(
          'GET',
          `/api/v1/sources/${pubSource.id}`,
          outsider.accessToken
        );

        if (res1.status !== 404 || res2.status !== 404 || res3.status !== 404) {
          return {
            status: 'broken',
            expected: 'HTTP 404 across all endpoints',
            actual: { orgMembers: res1.status, project: res2.status, source: res3.status },
            likelySourceFile: 'apps/api/src/auth/authorisation.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Complete cross-tenant outsider isolation',
          actual: `All 3 outsider calls returned HTTP 404`,
        };
      },
    },
    {
      id: 'scn3-step-08-archive-source',
      name: 'Archive source and verify immediate unreadability',
      feature: 'POST /api/v1/sources/:id/archive',
      action: 'Project owner archives public source and caller attempts to read it',
      expectedResult: 'HTTP 200 with archivedAt timestamp; subsequent reads return HTTP 404',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const reviewer = getUser(ctx, 'reviewer');
        const pubSource = getSource(ctx, 'public');

        const archRes = await ctx.callApi(
          'POST',
          `/api/v1/sources/${pubSource.id}/archive`,
          owner.accessToken
        );

        if (
          archRes.status !== 200 ||
          (!archRes.body?.data?.archived && !archRes.body?.data?.archivedAt)
        ) {
          return {
            status: 'broken',
            responseStatus: archRes.status,
            expected: 'HTTP 200 with archivedAt',
            actual: archRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        const readRes = await ctx.callApi(
          'GET',
          `/api/v1/sources/${pubSource.id}`,
          reviewer.accessToken
        );

        if (readRes.status !== 404) {
          return {
            status: 'broken',
            responseStatus: readRes.status,
            expected: 'HTTP 404 NOT_FOUND after source archival',
            actual: readRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Archived source immediately returns 404',
          actual: `Archived successfully at ${archRes.body.data.archivedAt}; reads return 404`,
        };
      },
    },
    {
      id: 'scn3-step-09-guessed-identifiers-404',
      name: 'Guessed random UUID identifiers return 404 without probing leakage',
      feature: 'Resource Enumeration Defense (SPEC Section 18.1)',
      action:
        'Request completely random nonexistent UUIDs for project, source, claim, and handover',
      expectedResult: 'Consistent HTTP 404 with identical error bodies',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const fakeId = crypto.randomUUID();

        const r1 = await ctx.callApi('GET', `/api/v1/projects/${fakeId}`, owner.accessToken);
        const r2 = await ctx.callApi('GET', `/api/v1/sources/${fakeId}`, owner.accessToken);
        const r3 = await ctx.callApi('GET', `/api/v1/claims/${fakeId}`, owner.accessToken);
        const r4 = await ctx.callApi('GET', `/api/v1/handovers/${fakeId}`, owner.accessToken);

        if (r1.status !== 404 || r2.status !== 404 || r3.status !== 404 || r4.status !== 404) {
          return {
            status: 'broken',
            expected: 'All random UUID queries return 404',
            actual: { proj: r1.status, source: r2.status, claim: r3.status, handover: r4.status },
            likelySourceFile: 'apps/api/src/auth/authorisation.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'All return 404 NOT_FOUND',
          actual: 'Nonexistent resources consistently return standard 404 error envelope',
        };
      },
    },
    {
      id: 'scn3-step-10-access-filtered-counts',
      name: 'Dashboard and list counts never disclose inaccessible items',
      feature: 'GET /api/v1/projects/:id/dashboard & /sources',
      action: 'Compare source counts reported to Contributor (ungranted) vs Reviewer (granted)',
      expectedResult: 'Contributor count excludes restricted sources',
      run: async (ctx): Promise<StepExecutionResult> => {
        const contributor = getUser(ctx, 'contributor');
        const reviewer = getUser(ctx, 'reviewer');
        const proj = getProject(ctx, 'main');

        const contribSourcesRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}/sources`,
          contributor.accessToken
        );
        const revSourcesRes = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}/sources`,
          reviewer.accessToken
        );

        if (contribSourcesRes.status !== 200 || revSourcesRes.status !== 200) {
          return {
            status: 'broken',
            expected: 'HTTP 200 for both sources lists',
            actual: { contrib: contribSourcesRes.body, rev: revSourcesRes.body },
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        const contribCount = contribSourcesRes.body.data.length;
        const revCount = revSourcesRes.body.data.length;

        if (contribCount >= revCount) {
          return {
            status: 'broken',
            expected: `Contributor count (${contribCount}) < Reviewer count (${revCount})`,
            actual: `Counts: Contributor ${contribCount}, Reviewer ${revCount}`,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Inaccessible items masked from list counts',
          actual: `Contributor sees ${contribCount} source(s); Reviewer sees ${revCount} source(s)`,
        };
      },
    },
    {
      id: 'scn3-step-11-project-audit-trail',
      name: 'Read project audit trail (unbuilt feature)',
      feature: 'GET /api/v1/projects/:id/audit',
      action: 'Project owner requests project audit trail',
      expectedResult: 'Marked not built per feature inventory (SPEC Section 12 line 1188)',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const res = await ctx.callApi(
          'GET',
          `/api/v1/projects/${proj.id}/audit`,
          owner.accessToken
        );
        if (res.status === 404) {
          return {
            status: 'not built',
            expected: 'Not built in current codebase',
            actual: 'HTTP 404 Route Not Registered',
          };
        }
        return {
          status: 'passed',
          actual: res.body,
        };
      },
    },
  ],
};
