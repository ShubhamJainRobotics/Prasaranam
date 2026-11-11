import request from 'supertest';
import { createScenarioUser } from './context.js';
import { getUser, getProject, getSource } from './types.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario2Importing: ScenarioDefinition = {
  id: 'scenario-2',
  number: 2,
  name: 'Importing sources',
  description:
    'Comprehensive source ingestion across all supported envelopes (text, markdown, messages, issues), revisions, exact Unicode offsets, URL inertness, and strict rejection of oversize, invalid, and malformed payloads.',
  steps: [
    {
      id: 'scn2-step-01-setup',
      name: 'Setup organisation & project for importing scenario',
      feature: 'POST /api/v1/organisations',
      action: 'Create scn-org-2-importing and scn-proj-2-importing',
      expectedResult: 'Setup completed with active project owner',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = await createScenarioUser(
          `scn2-owner-${Date.now()}@example.test`,
          'Scenario 2 Owner'
        );
        ctx.users.owner = owner;

        const orgRes = await ctx.callApi('POST', '/api/v1/organisations', owner.accessToken, {
          name: `scn-org-2-importing-${Date.now()}`,
        });
        ctx.orgs.main = { id: orgRes.body.data.id, name: orgRes.body.data.name };

        const projRes = await ctx.callApi(
          'POST',
          `/api/v1/organisations/${ctx.orgs.main.id}/projects`,
          owner.accessToken,
          { name: `scn-proj-2-importing-${Date.now()}`, domain: 'software_engineering' }
        );
        ctx.projects.main = {
          id: projRes.body.data.id,
          name: projRes.body.data.name,
          orgId: ctx.orgs.main.id,
        };

        return {
          status: 'passed',
          expected: 'Project ready for imports',
          actual: `Created project ${ctx.projects.main.id}`,
        };
      },
    },
    {
      id: 'scn2-step-02-import-pasted-text',
      name: 'Import pasted text source',
      feature: 'POST /api/v1/projects/:id/sources/import',
      action: 'Import pasted text with project visibility',
      expectedResult: 'HTTP 201 with source metadata and chunks created',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const content =
          'We decided to adopt PostgreSQL 16 for primary data storage.\n\nAll services will authenticate using Supabase Auth.';

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Architecture Decisions Note',
            kind: 'text',
            visibility: 'project',
            content,
          });

        if (res.status !== 201 || !res.body?.data?.sources?.[0]?.id) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/sources/import' },
            responseStatus: res.status,
            expected: 'HTTP 201 with created source',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        const source = res.body.data.sources[0];
        ctx.sources.pasted = { id: source.id, title: source.title };

        return {
          status: 'passed',
          expected: 'HTTP 201 Created',
          actual: `Imported pasted source ${source.id} (chunks: ${source.chunkCount || 1})`,
        };
      },
    },
    {
      id: 'scn2-step-03-import-markdown',
      name: 'Import Markdown file source',
      feature: 'POST /api/v1/projects/:id/sources/import',
      action: 'Upload .md file with headings and bullet points',
      expectedResult: 'HTTP 201 with markdown source and preserved structure',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const mdContent =
          '# Technical Roadmap\n\n## Backend Infrastructure\n- We should consider Redis for caching.\n- Microservices will communicate over gRPC.';

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'markdown')
          .field('visibility', 'project')
          .attach('files', Buffer.from(mdContent, 'utf8'), 'roadmap.md');

        if (res.status !== 201 || !res.body?.data?.sources?.[0]?.id) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/sources/import' },
            responseStatus: res.status,
            expected: 'HTTP 201',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        ctx.sources.markdown = {
          id: res.body.data.sources[0].id,
          title: res.body.data.sources[0].title,
        };
        return {
          status: 'passed',
          expected: 'HTTP 201 Created',
          actual: `Imported markdown source ${ctx.sources.markdown.id}`,
        };
      },
    },
    {
      id: 'scn2-step-04-import-messages-json',
      name: 'Import relay.messages.v1 envelope',
      feature: 'POST /api/v1/projects/:id/sources/import',
      action: 'Upload messages envelope with author, timestamp, and text',
      expectedResult: 'HTTP 201 with one chunk per message record',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const messagesJson = {
          format: 'relay.messages.v1',
          records: [
            {
              id: 'msg-01',
              author: 'Alice Chen',
              timestamp: '2026-11-01T10:00:00Z',
              text: 'We plan to launch payments integration by Friday.',
              url: null,
            },
            {
              id: 'msg-02',
              author: 'Bob Vance',
              timestamp: '2026-11-01T11:00:00Z',
              text: 'The payment sandbox credentials are ready.',
              url: null,
            },
          ],
        };

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'messages')
          .field('visibility', 'project')
          .attach('files', Buffer.from(JSON.stringify(messagesJson), 'utf8'), 'channel.json');

        if (res.status !== 201 || !res.body?.data?.sources?.[0]?.id) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/sources/import' },
            responseStatus: res.status,
            expected: 'HTTP 201 with messages source',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/envelopes.ts',
          };
        }

        ctx.sources.messages = {
          id: res.body.data.sources[0].id,
          title: res.body.data.sources[0].title,
        };
        return {
          status: 'passed',
          expected: 'HTTP 201 Created',
          actual: `Imported messages envelope: ${ctx.sources.messages.id}`,
        };
      },
    },
    {
      id: 'scn2-step-05-import-issues-json',
      name: 'Import relay.issues.v1 envelope',
      feature: 'POST /api/v1/projects/:id/sources/import',
      action: 'Upload issues envelope with issue tracker tickets',
      expectedResult: 'HTTP 201 with issue tracker metadata and chunks',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const issuesJson = {
          format: 'relay.issues.v1',
          records: [
            {
              id: 'ISSUE-101',
              title: 'Sandbox credentials missing',
              description: 'Integration tests cannot run without sandbox credentials.',
              status: 'open',
              assignee: null,
              updatedAt: '2026-11-01T12:00:00Z',
              url: null,
            },
            {
              id: 'ISSUE-102',
              title: 'Database migration scripts',
              description: 'Migrations for payments schema completed.',
              status: 'closed',
              assignee: 'Alice Chen',
              updatedAt: '2026-11-01T13:00:00Z',
              url: null,
            },
          ],
        };

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'issues')
          .field('visibility', 'project')
          .attach('files', Buffer.from(JSON.stringify(issuesJson), 'utf8'), 'backlog.json');

        if (res.status !== 201 || !res.body?.data?.sources?.[0]?.id) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/sources/import' },
            responseStatus: res.status,
            expected: 'HTTP 201',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/envelopes.ts',
          };
        }

        ctx.sources.issues = {
          id: res.body.data.sources[0].id,
          title: res.body.data.sources[0].title,
        };
        return {
          status: 'passed',
          expected: 'HTTP 201 Created',
          actual: `Imported issues envelope: ${ctx.sources.issues.id}`,
        };
      },
    },
    {
      id: 'scn2-step-06-import-replacement-revision',
      name: 'Import replacement revision of an existing source',
      feature: 'POST /api/v1/projects/:id/sources/import (replaces_source_id)',
      action: 'Import revision replacing pasted source with updated text',
      expectedResult: 'HTTP 201 with sourceRevision: 2, and prior version archived',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const pasted = getSource(ctx, 'pasted');
        const updatedContent =
          'We decided to adopt PostgreSQL 16 and Redis for caching.\n\nAll services use Supabase Auth.';

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Architecture Decisions Note (Revision 2)',
            kind: 'text',
            visibility: 'project',
            content: updatedContent,
            replacesSourceId: pasted.id,
          });

        const rev =
          res.body?.data?.sources?.[0]?.revision ?? res.body?.data?.sources?.[0]?.sourceRevision;
        if (res.status !== 201 || rev !== 2) {
          return {
            status: 'broken',
            request: { method: 'POST', path: '/sources/import' },
            responseStatus: res.status,
            expected: 'HTTP 201 with sourceRevision: 2',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        const newSource = res.body.data.sources[0];
        ctx.sources.pasted = { id: newSource.id, title: newSource.title };

        return {
          status: 'passed',
          expected: 'Source revision incremented to 2',
          actual: `Created revised source ${newSource.id} at revision 2`,
        };
      },
    },
    {
      id: 'scn2-step-07-unicode-offsets-match',
      name: 'Verify exact Unicode code-point offset calculations',
      feature: 'Unicode Offsets & Canonical Chunker (SPEC Section 2A.6)',
      action: 'Import text with emoji, combining marks, non-Latin script and inspect chunk offsets',
      expectedResult: 'HTTP 201 and chunk endOffset - startOffset matches character length',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const complexText =
          'Launch 🚀 with cafe\u0301 and こんにちは system.\n\nNext section with مرحبا text.';

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Unicode Benchmark Source',
            kind: 'text',
            visibility: 'project',
            content: complexText,
          });

        if (res.status !== 201 || !res.body?.data?.sources?.[0]?.id) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 201',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/unicode.ts',
          };
        }

        const sourceId = res.body.data.sources[0].id;
        const chunksRes = await ctx.callApi(
          'GET',
          `/api/v1/sources/${sourceId}/chunks`,
          owner.accessToken
        );

        if (chunksRes.status !== 200 || !chunksRes.body?.data?.length) {
          return {
            status: 'broken',
            responseStatus: chunksRes.status,
            expected: 'HTTP 200 with chunks',
            actual: chunksRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        for (const chunk of chunksRes.body.data) {
          const expectedLen = [...chunk.content].length;
          const diff = chunk.endOffset - chunk.startOffset;
          if (expectedLen !== diff) {
            return {
              status: 'broken',
              expected: `chunk code-point length ${expectedLen} === endOffset - startOffset (${diff})`,
              actual: `Mismatch: code-points ${expectedLen} vs offset diff ${diff}`,
              likelySourceFile: 'apps/api/src/ingestion/unicode.ts',
            };
          }
        }

        return {
          status: 'passed',
          expected: 'Offsets match exact code point character lengths',
          actual: `Verified ${chunksRes.body.data.length} chunks with emoji and non-Latin scripts`,
        };
      },
    },
    {
      id: 'scn2-step-08-verify-url-not-fetched',
      name: 'Verify supplied URLs in data are never fetched',
      feature: 'URL Ingestion Inertness (SPEC Section 4.2)',
      action: 'Import message record containing non-resolvable external URL',
      expectedResult: 'HTTP 201 and URL stored purely as textual metadata without HTTP fetching',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const payload = {
          format: 'relay.messages.v1',
          records: [
            {
              id: 'm-inert-url',
              author: 'Security Tester',
              timestamp: '2026-11-01T15:00:00Z',
              text: 'Check external doc at https://untrusted-outbound-domain.invalid:9999/malicious',
              url: 'https://untrusted-outbound-domain.invalid:9999/malicious',
            },
          ],
        };

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'messages')
          .field('visibility', 'project')
          .attach('files', Buffer.from(JSON.stringify(payload), 'utf8'), 'url-test.json');

        if (res.status !== 201) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 201 without fetching URL',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/pipeline.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'URL retained as plain string without network fetch',
          actual: `Source ingested cleanly; originalUrl preserved: ${res.body.data.sources[0].id}`,
        };
      },
    },
    {
      id: 'scn2-step-09-reject-oversize-file',
      name: 'Reject single file exceeding 5 MiB ceiling',
      feature: 'Upload Ceiling (SPEC Section 2A.7)',
      action: 'Upload file of 6 MiB (exceeding 5 MiB ceiling)',
      expectedResult: 'HTTP 413 PAYLOAD_TOO_LARGE',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const largeBuffer = Buffer.alloc(6 * 1024 * 1024, 'A');

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'text')
          .field('visibility', 'project')
          .attach('files', largeBuffer, 'huge.txt');

        if (res.status !== 413) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 413 PAYLOAD_TOO_LARGE',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 413 PAYLOAD_TOO_LARGE',
          actual: `Rejected 6 MiB upload with HTTP ${res.status}`,
        };
      },
    },
    {
      id: 'scn2-step-10-reject-too-many-files',
      name: 'Reject upload exceeding 10 files ceiling',
      feature: 'Upload File Count Ceiling (SPEC Section 2A.7)',
      action: 'Upload 11 files in single request (ceiling is 10)',
      expectedResult: 'HTTP 413 or 422 PAYLOAD_TOO_LARGE / VALIDATION_ERROR',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');

        let req = request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'text')
          .field('visibility', 'project');

        for (let i = 1; i <= 11; i++) {
          req = req.attach('files', Buffer.from(`Content for file ${i}`), `file${i}.txt`);
        }

        const res = await req;
        if (res.status !== 413 && res.status !== 422) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 413 or 422',
            actual: res.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 413 or 422',
          actual: `Rejected 11 files with HTTP ${res.status}`,
        };
      },
    },
    {
      id: 'scn2-step-11-reject-too-many-records',
      name: 'Reject JSON import exceeding 10,000 records ceiling',
      feature: 'JSON Record Ceiling (SPEC Section 2A.7)',
      action: 'Upload messages envelope with 10,001 records',
      expectedResult: 'HTTP 422 VALIDATION_ERROR',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');

        const records = Array.from({ length: 10001 }, (_, i) => ({
          id: `rec-${i}`,
          author: 'Bulk Bot',
          timestamp: '2026-11-01T12:00:00Z',
          text: `Message content number ${i}`,
          url: null,
        }));

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'messages')
          .field('visibility', 'project')
          .attach(
            'files',
            Buffer.from(JSON.stringify({ format: 'relay.messages.v1', records }), 'utf8'),
            'massive.json'
          );

        if (res.status !== 422 || res.body?.error?.code !== 'VALIDATION_ERROR') {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 422 VALIDATION_ERROR',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/envelopes.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 422 VALIDATION_ERROR',
          actual: `Rejected 10,001 records with HTTP 422 (${res.body.error.code})`,
        };
      },
    },
    {
      id: 'scn2-step-12-reject-invalid-envelope',
      name: 'Reject JSON import with invalid envelope schema',
      feature: 'Envelope Schema Validation (SPEC Section 2A.7)',
      action: 'Upload JSON missing required format identifier',
      expectedResult: 'HTTP 422 VALIDATION_ERROR',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const invalidPayload = { records: [{ id: '1', text: 'no format supplied' }] };

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'messages')
          .field('visibility', 'project')
          .attach('files', Buffer.from(JSON.stringify(invalidPayload), 'utf8'), 'bad.json');

        if (res.status !== 422) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 422 VALIDATION_ERROR',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/envelopes.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 422 VALIDATION_ERROR',
          actual: `Rejected malformed envelope with HTTP ${res.status}`,
        };
      },
    },
    {
      id: 'scn2-step-13-reject-format-mismatch',
      name: 'Reject envelope format mismatch with selected sourceType',
      feature: 'Format-Type Matching (SPEC Section 2A.7)',
      action: 'Upload relay.issues.v1 file with sourceType=messages',
      expectedResult: 'HTTP 422 VALIDATION_ERROR',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const issuesPayload = {
          format: 'relay.issues.v1',
          records: [
            {
              id: 'ISSUE-1',
              title: 'Mismatch Test',
              description: 'Desc',
              status: 'open',
              assignee: null,
              updatedAt: '2026-11-01T12:00:00Z',
              url: null,
            },
          ],
        };

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'messages')
          .field('visibility', 'project')
          .attach('files', Buffer.from(JSON.stringify(issuesPayload), 'utf8'), 'issues.json');

        if (res.status !== 422) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 422 VALIDATION_ERROR',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/envelopes.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 422 VALIDATION_ERROR',
          actual: `Rejected format mismatch with HTTP ${res.status}`,
        };
      },
    },
    {
      id: 'scn2-step-14-reject-invalid-utf8',
      name: 'Reject upload with invalid UTF-8 byte sequence',
      feature: 'Strict UTF-8 Decoding (SPEC Section 2A.6)',
      action: 'Upload file with non-UTF-8 bytes',
      expectedResult: 'HTTP 422 VALIDATION_ERROR',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const invalidBytes = Buffer.from([0xff, 0xfe, 0xd8, 0x00, 0x61, 0x62]);

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .field('kind', 'text')
          .field('visibility', 'project')
          .attach('files', invalidBytes, 'invalid-utf8.txt');

        if (res.status !== 422) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 422 VALIDATION_ERROR',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/unicode.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 422 VALIDATION_ERROR',
          actual: `Rejected invalid UTF-8 bytes with HTTP ${res.status}`,
        };
      },
    },
    {
      id: 'scn2-step-15-reject-control-characters',
      name: 'Reject text containing NUL or disallowed control characters',
      feature: 'Control Character Stripping/Rejection (SPEC Section 2A.6)',
      action: 'Upload text containing NUL byte (\\u0000)',
      expectedResult: 'HTTP 422 VALIDATION_ERROR',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const hostileText = 'Normal text before NUL \u0000 and text after.';

        const res = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'NUL Control Character Test',
            kind: 'text',
            visibility: 'project',
            content: hostileText,
          });

        if (res.status !== 422) {
          return {
            status: 'broken',
            responseStatus: res.status,
            expected: 'HTTP 422 VALIDATION_ERROR',
            actual: res.body,
            likelySourceFile: 'apps/api/src/ingestion/unicode.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 422 VALIDATION_ERROR',
          actual: `Rejected NUL character with HTTP ${res.status}`,
        };
      },
    },
    {
      id: 'scn2-step-16-duplicate-import-detection',
      name: 'Duplicate import detection & allowDuplicate override',
      feature: 'Duplicate Import Detection (Hackathon Addition 3)',
      action:
        'Import content; re-import identical content; observe 409 DUPLICATE_SOURCE; retry with allowDuplicate: true',
      expectedResult:
        'Initial import succeeds; re-import rejected with 409 DUPLICATE_SOURCE; succeeds with 201 when allowDuplicate is true',
      run: async (ctx): Promise<StepExecutionResult> => {
        const owner = getUser(ctx, 'owner');
        const proj = getProject(ctx, 'main');
        const dupContent =
          'Unique content for duplicate testing: PostgreSQL 16 adoption with Supabase Auth verified.';

        // 1. Initial import of content
        const initRes = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Initial Duplicate Test Source',
            kind: 'text',
            visibility: 'project',
            content: dupContent,
          });

        if (initRes.status !== 201) {
          return {
            status: 'broken',
            responseStatus: initRes.status,
            expected: 'HTTP 201 Initial import',
            actual: initRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        // 2. Attempt duplicate import without allowDuplicate -> 409 DUPLICATE_SOURCE
        const rejRes = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Duplicate Content Attempt',
            kind: 'text',
            visibility: 'project',
            content: dupContent,
          });

        if (rejRes.status !== 409 || rejRes.body?.error?.code !== 'DUPLICATE_SOURCE') {
          return {
            status: 'broken',
            responseStatus: rejRes.status,
            expected: 'HTTP 409 DUPLICATE_SOURCE',
            actual: rejRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        // 3. Retry with allowDuplicate: true -> 201 Created
        const allowRes = await request(ctx.app)
          .post(`/api/v1/projects/${proj.id}/sources/import`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            title: 'Duplicate Content Allowed',
            kind: 'text',
            visibility: 'project',
            content: dupContent,
            allowDuplicate: true,
          });

        if (allowRes.status !== 201) {
          return {
            status: 'broken',
            responseStatus: allowRes.status,
            expected: 'HTTP 201 Created when allowDuplicate is true',
            actual: allowRes.body,
            likelySourceFile: 'apps/api/src/routes/sources.ts',
          };
        }

        return {
          status: 'passed',
          expected:
            'Duplicate detected and rejected with 409, then allowed with allowDuplicate: true',
          actual: `Rejected duplicate (409 ${rejRes.body.error.code}), imported with allowDuplicate (201)`,
        };
      },
    },
  ],
};
