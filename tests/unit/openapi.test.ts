import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../apps/api/src/app.js';
import { mockDevServerEnv } from '../../packages/test-fixtures/src/index.js';

describe('OpenAPI 3.1 Route Parity', () => {
  it('every Express route is documented in docs/openapi.yaml and vice versa', () => {
    // 1. Read and parse docs/openapi.yaml endpoints
    const openApiPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
    expect(fs.existsSync(openApiPath), 'docs/openapi.yaml must exist').toBe(true);
    const content = fs.readFileSync(openApiPath, 'utf8');
    const lines = content.split('\n');

    let inPaths = false;
    let currentPath = '';
    const documentedEndpoints = new Set<string>();

    for (const line of lines) {
      if (line.startsWith('paths:')) {
        inPaths = true;
        continue;
      }
      if (inPaths && line.startsWith('components:')) {
        inPaths = false;
        break;
      }
      if (!inPaths) continue;

      const pathMatch = line.match(/^ {2}(\/[^:]+):/);
      if (pathMatch) {
        currentPath = pathMatch[1].trim();
        continue;
      }

      const methodMatch = line.match(/^ {4}(get|post|patch|delete|put):/);
      if (methodMatch && currentPath) {
        const method = methodMatch[1].toUpperCase();
        documentedEndpoints.add(`${method} ${currentPath}`);
      }
    }

    expect(documentedEndpoints.size).toBeGreaterThan(0);

    // 2. Extract all registered Express endpoints
    const pool = {} as any;
    const app = createApp({ env: mockDevServerEnv as any, pool });

    function extractRoutes(stack: any[], prefix = ''): Array<{ method: string; path: string }> {
      const res: Array<{ method: string; path: string }> = [];
      for (const layer of stack) {
        if (layer.route) {
          const rawPath = (prefix + layer.route.path).replace(/\/+/g, '/');
          // Normalize trailing slash except root
          const cleanPath =
            rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          // Normalize parameter format from Express :param to OpenAPI {param}
          const openApiPathNormalized = cleanPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');

          for (const m of Object.keys(layer.route.methods)) {
            if (layer.route.methods[m]) {
              res.push({ method: m.toUpperCase(), path: openApiPathNormalized });
            }
          }
        } else if (layer.name === 'router' && layer.handle.stack) {
          let subPrefix = prefix;
          const re = layer.regexp?.source || '';
          if (re.includes('api\\/v1')) subPrefix += '/api/v1';
          else if (re.includes('health')) subPrefix += '/health';
          else if (re.includes('organisations')) subPrefix += '/organisations';
          else if (re.includes('projects')) subPrefix += '/projects';
          else if (re.includes('me')) subPrefix += '/me';
          res.push(...extractRoutes(layer.handle.stack, subPrefix));
        }
      }
      return res;
    }

    const expressRoutes = extractRoutes((app as any)._router.stack);
    const expressEndpoints = new Set<string>();

    for (const r of expressRoutes) {
      expressEndpoints.add(`${r.method} ${r.path}`);
    }

    // 3. Verify bidirectional parity
    const undocumented: string[] = [];
    for (const ep of expressEndpoints) {
      if (!documentedEndpoints.has(ep)) {
        undocumented.push(ep);
      }
    }

    const extraDocumented: string[] = [];
    for (const ep of documentedEndpoints) {
      if (!expressEndpoints.has(ep)) {
        extraDocumented.push(ep);
      }
    }

    expect(
      undocumented,
      `Express routes missing from docs/openapi.yaml:\n${undocumented.join('\n')}`
    ).toEqual([]);

    expect(
      extraDocumented,
      `Endpoints in docs/openapi.yaml not implemented in Express router:\n${extraDocumented.join('\n')}`
    ).toEqual([]);
  });
});
