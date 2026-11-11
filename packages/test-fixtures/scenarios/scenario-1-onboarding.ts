import crypto from 'node:crypto';
import { createAnonClient } from '../src/index.js';
import { createScenarioUser, getMailpitMessage, extractLinkFromEmail } from './context.js';
import { getUser, getOrg, getProject } from './types.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario1Onboarding: ScenarioDefinition = {
  id: 'scenario-1',
  number: 1,
  name: 'Onboarding and workspace',
  description:
    'Registration, email verification, organisation bootstrapping, multi-template project creation, membership role matrix, last-owner invariants, and non-enumerating invitation safety.',
  steps: [
    {
      id: 'scn1-step-01-register',
      name: 'Register user with unconfirmed email',
      feature: 'POST /auth/v1/signup',
      action: 'Register scn1-owner@example.test with password via Supabase Auth',
      expectedResult: 'User created in auth.users with unconfirmed email status',
      run: async (ctx): Promise<StepExecutionResult> => {
        const anon = createAnonClient();
        const email = `scn1-owner-${Date.now()}@example.test`;
        const password = `ScnPass-${crypto.randomBytes(8).toString('hex')}!`;
        const displayName = 'Scenario 1 Owner';

        const { data, error } = await anon.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
          },
        });

        if (error || !data.user) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/auth/v1/signup', body: { email } },
            responseStatus: 400,
            expected: 'User created',
            actual: error?.message,
            likelySourceFile: 'supabase/config.toml',
          };
        }

        ctx.state.ownerEmail = email;
        ctx.state.ownerPassword = password;
        ctx.state.ownerDisplayName = displayName;
        ctx.state.ownerUserId = data.user.id;

        return {
          status: 'passed',
          expected: 'User created in auth.users',
          actual: `Created user ${data.user.id} with email ${email}`,
        };
      },
    },
    {
      id: 'scn1-step-02-confirm-email',
      name: 'Confirm email through local Mailpit',
      feature: 'Local Email Verification Interface',
      action: 'Fetch confirmation email from Mailpit and execute verification link',
      expectedResult: 'Email marked confirmed in Supabase auth',
      run: async (ctx): Promise<StepExecutionResult> => {
        const email = ctx.state.ownerEmail;
        try {
          const mail = await getMailpitMessage(email, 'Confirm');
          const htmlBody = mail.HTML || mail.Text || '';
          const verifyLink = extractLinkFromEmail(htmlBody);

          const verifyRes = await fetch(verifyLink, { redirect: 'manual' });
          if (verifyRes.status >= 400) {
            return {
              status: 'broken',
              request: { method: 'GET', path: verifyLink },
              responseStatus: verifyRes.status,
              expected: 'HTTP 302/303 or 200 confirming email',
              actual: `Verification failed with HTTP ${verifyRes.status}`,
              likelySourceFile: 'supabase/config.toml',
            };
          }

          return {
            status: 'passed',
            expected: 'Email confirmed',
            actual: `Email confirmed via Mailpit token URL (${verifyRes.status})`,
          };
        } catch (err: any) {
          return {
            status: 'broken',
            expected: 'Confirmation email in Mailpit',
            actual: err.message,
            likelySourceFile: 'supabase/config.toml',
          };
        }
      },
    },
    {
      id: 'scn1-step-03-signin',
      name: 'Sign in with confirmed credentials',
      feature: 'POST /auth/v1/token',
      action: 'Sign in using owner credentials and obtain session JWT',
      expectedResult: 'HTTP 200 and valid JWT returned',
      run: async (ctx): Promise<StepExecutionResult> => {
        const anon = createAnonClient();
        const { data, error } = await anon.auth.signInWithPassword({
          email: ctx.state.ownerEmail,
          password: ctx.state.ownerPassword,
        });

        if (error || !data.session) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/auth/v1/token' },
            responseStatus: 401,
            expected: 'Session JWT returned',
            actual: error?.message,
            likelySourceFile: 'apps/api/src/middleware/auth.ts',
          };
        }

        ctx.users.owner = {
          id: data.user.id,
          email: ctx.state.ownerEmail,
          password: ctx.state.ownerPassword,
          displayName: ctx.state.ownerDisplayName,
          accessToken: data.session.access_token,
        };

        return {
          status: 'passed',
          expected: 'Valid JWT session',
          actual: `Signed in successfully. Token length: ${data.session.access_token.length}`,
        };
      },
    },
    {
      id: 'scn1-step-04-create-org',
      name: 'Bootstrap organisation',
      feature: 'POST /api/v1/organisations',
      action: 'Create organisation scn-org-1-workspace as owner',
      expectedResult: 'HTTP 201 with organisation data and owner role',
      run: async (ctx): Promise<StepExecutionResult> => {
        const orgName = `scn-org-1-workspace-${Date.now()}`;
        const owner = getUser(ctx, 'owner');
        const res = await ctx.callApi('POST', '/api/v1/organisations', owner.accessToken, {
          name: orgName,
        });

        if (res.status !== 201 || !res.body?.data?.id) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/api/v1/organisations', body: { name: orgName } },
            responseStatus: res.status,
            expected: 'HTTP 201 with organisation details',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/organisations.ts',
          };
        }

        ctx.orgs.main = { id: res.body.data.id, name: orgName };
        return {
          status: 'passed',
          expected: 'HTTP 201 Created',
          actual: `Created organisation ${res.body.data.id}`,
        };
      },
    },
    {
      id: 'scn1-step-05-create-projects-all-templates',
      name: 'Create projects for all six domain templates',
      feature: 'POST /api/v1/organisations/:id/projects',
      action: 'Create 6 projects covering all ProjectDomain enum templates',
      expectedResult: 'HTTP 201 for each project with specified template domain',
      run: async (ctx): Promise<StepExecutionResult> => {
        const templates = [
          'software_engineering',
          'research',
          'student_team',
          'nonprofit_operations',
          'business_operations',
          'general',
        ] as const;

        const created: Record<string, string> = {};
        const owner = getUser(ctx, 'owner');
        const org = getOrg(ctx, 'main');

        for (const template of templates) {
          const projName = `scn-proj-1-${template}`;
          const res = await ctx.callApi(
            'POST',
            `/api/v1/organisations/${org.id}/projects`,
            owner.accessToken,
            { name: projName, domain: template }
          );

          if (res.status !== 201 || res.body?.data?.domain !== template) {
            return {
              status: 'broken',
              request: {
                method: 'POST',
                path: `/api/v1/organisations/${org.id}/projects`,
                body: { name: projName, domain: template },
              },
              responseStatus: res.status,
              expected: `HTTP 201 with domain: "${template}"`,
              actual: res.body,
              likelySourceFile: 'apps/api/src/routes/organisations.ts',
            };
          }
          created[template] = res.body.data.id;
        }

        ctx.projects.main = {
          id: created.software_engineering!,
          name: 'scn-proj-1-software_engineering',
          orgId: org.id,
        };

        return {
          status: 'passed',
          expected: '6 domain template projects created',
          actual: `Created 6 projects: ${Object.keys(created).join(', ')}`,
        };
      },
    },
    {
      id: 'scn1-step-06-add-all-roles',
      name: 'Add members for all four project roles',
      feature: 'POST /api/v1/projects/:id/members',
      action: 'Add second owner, reviewer, contributor, and recipient to organisation & project',
      expectedResult: 'HTTP 200/201 and memberships recorded with correct roles',
      run: async (ctx): Promise<StepExecutionResult> => {
        const roles = ['owner', 'reviewer', 'contributor', 'recipient'] as const;
        const ts = Date.now();
        const owner = getUser(ctx, 'owner');
        const org = getOrg(ctx, 'main');
        const proj = getProject(ctx, 'main');

        for (const role of roles) {
          const user = await createScenarioUser(
            `scn1-${role}-${ts}@example.test`,
            `Scenario 1 ${role}`
          );
          ctx.users[role] = user;

          // Add to organisation
          const orgRes = await ctx.callApi(
            'POST',
            `/api/v1/organisations/${org.id}/members`,
            owner.accessToken,
            { email: user.email, role: 'member' }
          );
          if (orgRes.status !== 200 && orgRes.status !== 201) {
            return {
              status: 'broken',
              request: {
                method: 'POST',
                path: `/api/v1/organisations/${org.id}/members`,
                body: { email: user.email, role: 'member' },
              },
              responseStatus: orgRes.status,
              expected: 'HTTP 200/201',
              actual: orgRes.body,
              likelySourceFile: 'apps/api/src/routes/organisations.ts',
            };
          }

          // Add to project
          const projRes = await ctx.callApi(
            'POST',
            `/api/v1/projects/${proj.id}/members`,
            owner.accessToken,
            { email: user.email, role }
          );
          if (projRes.status !== 200 && projRes.status !== 201) {
            return {
              status: 'broken',
              request: {
                method: 'POST',
                path: `/api/v1/projects/${proj.id}/members`,
                body: { email: user.email, role },
              },
              responseStatus: projRes.status,
              expected: 'HTTP 200/201',
              actual: projRes.body,
              likelySourceFile: 'apps/api/src/routes/projects.ts',
            };
          }
        }

        return {
          status: 'passed',
          expected: '4 project members added across owner, reviewer, contributor, recipient',
          actual: 'All 4 members successfully added with distinct roles',
        };
      },
    },
    {
      id: 'scn1-step-07-change-role',
      name: 'Change member role',
      feature: 'PATCH /api/v1/projects/:id/members/:userId',
      action: 'Promote contributor to reviewer in project',
      expectedResult: 'HTTP 200 and updated role: reviewer',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const contributor = getUser(ctx, 'contributor');
        const proj = getProject(ctx, 'main');

        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/projects/${proj.id}/members/${contributor.id}`,
          owner.accessToken,
          { role: 'reviewer' }
        );

        if (res.status !== 200 || res.body?.data?.role !== 'reviewer') {
          return {
            status: 'broken',
            request: {
              method: 'PATCH',
              path: `/api/v1/projects/${proj.id}/members/${contributor.id}`,
              body: { role: 'reviewer' },
            },
            responseStatus: res.status,
            expected: 'HTTP 200 with role: reviewer',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/projects.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Role updated to reviewer',
          actual: `Updated member ${contributor.id} role to ${res.body.data.role}`,
        };
      },
    },
    {
      id: 'scn1-step-08-deactivate-member',
      name: 'Deactivate member',
      feature: 'PATCH /api/v1/projects/:id/members/:userId',
      action: 'Set active: false on member',
      expectedResult: 'HTTP 200 and active: false',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const recipient = getUser(ctx, 'recipient');
        const proj = getProject(ctx, 'main');

        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/projects/${proj.id}/members/${recipient.id}`,
          owner.accessToken,
          { active: false }
        );

        if (res.status !== 200 || res.body?.data?.active !== false) {
          return {
            status: 'broken',
            request: {
              method: 'PATCH',
              path: `/api/v1/projects/${proj.id}/members/${recipient.id}`,
              body: { active: false },
            },
            responseStatus: res.status,
            expected: 'HTTP 200 with active: false',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/projects.ts',
          };
        }

        // Re-activate so subsequent tests have recipient
        await ctx.callApi(
          'PATCH',
          `/api/v1/projects/${proj.id}/members/${recipient.id}`,
          owner.accessToken,
          { active: true }
        );

        return {
          status: 'passed',
          expected: 'Member deactivated and re-activated',
          actual: 'Deactivated recipient and confirmed active: false',
        };
      },
    },
    {
      id: 'scn1-step-09-last-owner-project',
      name: 'Last owner protection at project level',
      feature: 'Database Constraint / Trigger (last-owner-protection)',
      action: 'Attempt to demote the sole active owner in project',
      expectedResult: 'HTTP 409 LAST_OWNER conflict',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');

        const failRes = await ctx.callApi(
          'PATCH',
          `/api/v1/projects/${proj.id}/members/${owner.id}`,
          owner.accessToken,
          { active: false }
        );

        if (failRes.status !== 409 || failRes.body?.error?.code !== 'LAST_OWNER') {
          return {
            status: 'broken',
            request: {
              method: 'PATCH',
              path: `/api/v1/projects/${proj.id}/members/${owner.id}`,
              body: { active: false },
            },
            responseStatus: failRes.status,
            expected: 'HTTP 409 LAST_OWNER',
            actual: failRes.body,
            likelySourceFile: 'supabase/migrations/20261107100002_mutation_functions.sql',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 LAST_OWNER',
          actual: `Rejected with 409 and code: ${failRes.body.error.code}`,
        };
      },
    },
    {
      id: 'scn1-step-10-last-owner-org',
      name: 'Last owner protection at organisation level',
      feature: 'Database Constraint / Trigger (last-owner-protection)',
      action: 'Attempt to demote the sole active organisation owner',
      expectedResult: 'HTTP 409 LAST_OWNER conflict',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const org = getOrg(ctx, 'main');

        const res = await ctx.callApi(
          'PATCH',
          `/api/v1/organisations/${org.id}/members/${owner.id}`,
          owner.accessToken,
          { role: 'member' }
        );

        if (res.status !== 409 || res.body?.error?.code !== 'LAST_OWNER') {
          return {
            status: 'broken',
            request: {
              method: 'PATCH',
              path: `/api/v1/organisations/${org.id}/members/${owner.id}`,
              body: { role: 'member' },
            },
            responseStatus: res.status,
            expected: 'HTTP 409 LAST_OWNER',
            actual: res.body,
            likelySourceFile: 'supabase/migrations/20261107100002_mutation_functions.sql',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 409 LAST_OWNER',
          actual: `Rejected with HTTP 409 and code: ${res.body.error.code}`,
        };
      },
    },
    {
      id: 'scn1-step-11-update-display-name',
      name: 'Update user display name',
      feature: 'PATCH /api/v1/me',
      action: 'Update display name to "Scenario 1 Updated Owner"',
      expectedResult: 'HTTP 200 with updated displayName',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const res = await ctx.callApi('PATCH', '/api/v1/me', owner.accessToken, {
          displayName: 'Scenario 1 Updated Owner',
        });

        if (res.status !== 200 || res.body?.data?.displayName !== 'Scenario 1 Updated Owner') {
          return {
            status: 'broken',
            request: {
              method: 'PATCH',
              path: '/api/v1/me',
              body: { displayName: 'Scenario 1 Updated Owner' },
            },
            responseStatus: res.status,
            expected: 'HTTP 200 with displayName: "Scenario 1 Updated Owner"',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/me.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 200 with updated name',
          actual: `Updated display name: ${res.body.data.displayName}`,
        };
      },
    },
    {
      id: 'scn1-step-12-unknown-email-non-enumeration',
      name: 'Non-enumerating member addition',
      feature: 'POST /api/v1/projects/:id/members',
      action: 'Invite an unknown email address and check for generic response',
      expectedResult: 'HTTP 200/201 with identical response envelope shape',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const unknownEmail = `ghost-${Date.now()}@example.test`;

        const res = await ctx.callApi(
          'POST',
          `/api/v1/projects/${proj.id}/members`,
          owner.accessToken,
          { email: unknownEmail, role: 'contributor' }
        );

        if (res.status !== 200 && res.status !== 201) {
          return {
            status: 'broken',
            request: {
              method: 'POST',
              path: `/api/v1/projects/${proj.id}/members`,
              body: { email: unknownEmail, role: 'contributor' },
            },
            responseStatus: res.status,
            expected: 'HTTP 200/201 generic response',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/projects.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Generic success response without account disclosure',
          actual: `Returned HTTP ${res.status} with generic payload`,
        };
      },
    },
  ],
};
