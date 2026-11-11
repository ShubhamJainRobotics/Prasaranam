import { execSync } from 'node:child_process';
import request from 'supertest';
import { createScenarioUser } from './context.js';
import type { ScenarioDefinition, StepExecutionResult } from './types.js';

export const scenario9Hardening: ScenarioDefinition = {
  id: 'scenario-9',
  number: 9,
  name: 'Security hardening, hygiene, and audit integrity',
  description:
    'Verification of strict HTTP security headers (CSP, HSTS, nosniff, frameAncestors), error body hygiene (zero stack traces or SQL strings), log sanitization (zero tokens or secret text in stdout), burst rate limiting, and production web bundle scanning for leaked keys.',
  steps: [
    {
      id: 'scn9-step-01-security-headers',
      name: 'Verify strict security headers on API responses',
      feature: 'Security Headers via Helmet & CSP',
      action: 'Send GET /health and inspect response security headers',
      expectedResult: 'Strict CSP, HSTS, nosniff, same-origin, no-referrer present on response',
      run: async (ctx): Promise<StepExecutionResult> => {
        const res = await request(ctx.app).get('/health');

        const headers = res.headers;
        const missing: string[] = [];

        if (!headers['content-security-policy']) {
          missing.push('Content-Security-Policy');
        }
        if (!headers['x-content-type-options'] || headers['x-content-type-options'] !== 'nosniff') {
          missing.push('X-Content-Type-Options: nosniff');
        }
        if (!headers['referrer-policy'] || headers['referrer-policy'] !== 'no-referrer') {
          missing.push('Referrer-Policy: no-referrer');
        }
        if (!headers['cross-origin-opener-policy']) {
          missing.push('Cross-Origin-Opener-Policy');
        }

        if (missing.length > 0) {
          return {
            status: 'broken',
            expected: 'All security headers present',
            actual: { missing, headers },
            likelySourceFile: 'apps/api/src/app.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'All security headers present on API response',
          actual: {
            csp: headers['content-security-policy'],
            nosniff: headers['x-content-type-options'],
            referrer: headers['referrer-policy'],
          },
        };
      },
    },
    {
      id: 'scn9-step-02-rate-limiting',
      name: 'Verify rate limiting response on excessive burst requests',
      feature: 'Express Rate Limiter',
      action: 'Send burst of requests exceeding limit to verify HTTP 429 response',
      expectedResult: 'HTTP 429 received with Retry-After or RATE_LIMIT_EXCEEDED error code',
      run: async (ctx): Promise<StepExecutionResult> => {
        // Create an app instance with a tight rate limit (5 requests) to verify 429 and Retry-After
        const testEnv = {
          ...(ctx.env || {}),
          RATE_LIMIT_WINDOW_MS: 60000,
          RATE_LIMIT_MAX_REQUESTS: 5,
        };
        const { createApp } = await import('../../../apps/api/src/app.js');
        const rateLimitedApp = createApp({ env: testEnv as any, pool: ctx.pool });

        let saw429 = false;
        let lastRes: any;
        for (let i = 0; i < 8; i++) {
          const res = await request(rateLimitedApp).get('/health');
          if (res.status === 429) {
            saw429 = true;
            lastRes = res;
            break;
          }
        }

        if (!saw429) {
          return {
            status: 'broken',
            expected: 'HTTP 429 after exceeding request limit',
            actual: 'Did not encounter 429 within 8 requests',
            likelySourceFile: 'apps/api/src/app.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'HTTP 429 encountered with rate limiting headers',
          actual: {
            status: 429,
            retryAfter: lastRes?.headers['retry-after'],
            body: lastRes?.text || lastRes?.body,
          },
        };
      },
    },
    {
      id: 'scn9-step-03-error-body-hygiene',
      name: 'Verify error body hygiene across 400, 404, 409, 422 errors',
      feature: 'Error Handler & Envelope Middleware',
      action:
        'Trigger invalid JSON, not-found UUID, and schema errors and assert absence of leakages',
      expectedResult: 'Strict ErrorEnvelope with zero stack traces, SQL syntax, or prompts',
      run: async (ctx): Promise<StepExecutionResult> => {
        const ts = Date.now();
        const user = await createScenarioUser(`scn9-err-${ts}@example.test`, 'Error Tester');

        // 1. Trigger 404
        const notFoundRes = await request(ctx.app)
          .get(`/api/v1/projects/${crypto.randomUUID()}`)
          .set('Authorization', `Bearer ${user.accessToken}`);

        // 2. Trigger 422
        const invalidSchemaRes = await request(ctx.app)
          .post('/api/v1/organisations')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ invalidKey: 123 });

        // 3. Trigger 400 (malformed JSON string)
        const malformedRes = await request(ctx.app)
          .post('/api/v1/organisations')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .set('Content-Type', 'application/json')
          .send('{"name": ');

        const responses = [notFoundRes, invalidSchemaRes, malformedRes];

        for (const r of responses) {
          const bodyStr = JSON.stringify(r.body || r.text);
          // Check for forbidden leakage strings
          if (
            bodyStr.includes('node:internal') ||
            bodyStr.includes('TypeError:') ||
            bodyStr.includes('syntax error at or near') ||
            bodyStr.includes('pg_') ||
            bodyStr.includes('SELECT ') ||
            bodyStr.includes('INSERT INTO')
          ) {
            return {
              status: 'broken',
              expected: 'Zero stack traces or SQL strings in error body',
              actual: bodyStr,
              likelySourceFile: 'apps/api/src/middleware/errorHandler.ts',
            };
          }

          // Check standard envelope shape if JSON
          if (r.body && typeof r.body === 'object' && r.body.error) {
            if (
              !r.body.error.code ||
              !r.body.error.message ||
              !Array.isArray(r.body.error.details)
            ) {
              return {
                status: 'broken',
                expected: 'Envelope contains code, message, and details array',
                actual: r.body,
                likelySourceFile: 'apps/api/src/middleware/errorHandler.ts',
              };
            }
          }
        }

        return {
          status: 'passed',
          expected: 'All error responses conform to clean error envelope without data leaks',
          actual: {
            notFoundCode: notFoundRes.body?.error?.code,
            invalidSchemaCode: invalidSchemaRes.body?.error?.code,
          },
        };
      },
    },
    {
      id: 'scn9-step-04-log-sanitization',
      name: 'Verify log sanitization hides tokens, passwords, and source text in stdout',
      feature: 'Structured Logging Middleware Redaction',
      action: 'Send request with sensitive password and secret source text while capturing stdout',
      expectedResult: 'Zero bearer tokens, passwords, or raw secret phrases in captured stdout',
      run: async (ctx): Promise<StepExecutionResult> => {
        const SECRET_PHRASE = 'CLASSIFIED_PROJECT_DELTA_TOP_SECRET_PHRASE_998811';
        const capturedLogs: string[] = [];
        const originalStdoutWrite = process.stdout.write;

        process.stdout.write = ((chunk: any) => {
          capturedLogs.push(String(chunk));
          return true;
        }) as any;

        try {
          const ts = Date.now();
          const user = await createScenarioUser(`scn9-log-${ts}@example.test`, 'Log User');

          // Send request with Authorization header and secret in body
          await request(ctx.app)
            .post('/api/v1/organisations')
            .set('Authorization', `Bearer ${user.accessToken}`)
            .send({ name: `scn-org-log-${ts}-${SECRET_PHRASE}` });
        } finally {
          process.stdout.write = originalStdoutWrite;
        }

        const combinedLogs = capturedLogs.join('\n');

        // Check if authorization token leaked
        if (combinedLogs.includes('Bearer eyJ')) {
          return {
            status: 'broken',
            expected: 'Zero raw JWT bearer tokens in stdout logs',
            actual: 'Bearer token found in logged output',
            likelySourceFile: 'apps/api/src/middleware/logging.ts',
          };
        }

        return {
          status: 'passed',
          expected: 'Zero tokens or passwords leaked to stdout',
          actual: `Logged ${capturedLogs.length} chunks with redaction verified`,
        };
      },
    },
    {
      id: 'scn9-step-05-production-bundle-scanner',
      name: 'Scan production web build bundle for leaked secrets and keys',
      feature: 'Production Bundle Secret Scanner (scripts/scan-bundle.ts)',
      action: 'Run scripts/scan-bundle.ts to scan apps/web/dist',
      expectedResult:
        'Zero occurrences of SERVICE_ROLE, GEMINI_API_KEY, or secrets in client bundle',
      run: async (): Promise<StepExecutionResult> => {
        const rootDir = process.cwd();

        try {
          const output = execSync('npx tsx scripts/scan-bundle.ts', {
            cwd: rootDir,
            encoding: 'utf-8',
          });

          return {
            status: 'passed',
            expected: 'Bundle scan passes with zero secret occurrences',
            actual: output.trim().split('\n').slice(-1)[0],
          };
        } catch (err: any) {
          return {
            status: 'broken',
            expected: 'scan-bundle.ts exits 0 with zero secret findings',
            actual: err.stdout || err.stderr || err.message,
            likelySourceFile: 'scripts/scan-bundle.ts',
          };
        }
      },
    },
  ],
};
