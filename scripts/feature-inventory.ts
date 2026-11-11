import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../apps/api/src/app.js';
import { mockDevServerEnv } from '../packages/test-fixtures/src/index.js';

export interface RouteItem {
  method?: string; // GET, POST, etc. (for API routes)
  path: string;
  specSection: string;
  purpose: string;
  status: 'implemented' | 'not built';
  notes?: string;
}

export interface FeatureInventory {
  generatedAt: string;
  apiRoutes: RouteItem[];
  webRoutes: RouteItem[];
  summary: {
    totalApi: number;
    implementedApi: number;
    notBuiltApi: number;
    totalWeb: number;
    implementedWeb: number;
    notBuiltWeb: number;
  };
}

/**
 * Extracts all registered Express routes by traversing router layers.
 */
function extractExpressRoutes(): Set<string> {
  const pool = {} as any;
  const app = createApp({ env: mockDevServerEnv as any, pool });

  function traverseStack(stack: any[], prefix = ''): Array<{ method: string; path: string }> {
    const res: Array<{ method: string; path: string }> = [];
    for (const layer of stack) {
      if (layer.route) {
        const rawPath = (prefix + layer.route.path).replace(/\/+/g, '/');
        const cleanPath =
          rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
        // Normalize Express :param to :param standard representation
        for (const m of Object.keys(layer.route.methods)) {
          if (layer.route.methods[m]) {
            res.push({ method: m.toUpperCase(), path: cleanPath });
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        let subPrefix = prefix;
        const re = layer.regexp?.source || '';
        if (re.includes('api\\/v1')) subPrefix += '/api/v1';
        else if (re.includes('health')) subPrefix += '/health';
        else if (re.includes('organisations')) subPrefix += '/organisations';
        else if (re.includes('projects')) subPrefix += '/projects';
        else if (re.includes('me')) subPrefix += '/me';
        res.push(...traverseStack(layer.handle.stack, subPrefix));
      }
    }
    return res;
  }

  const routes = traverseStack((app as any)._router.stack);
  const endpointSet = new Set<string>();
  for (const r of routes) {
    endpointSet.add(`${r.method} ${r.path}`);
  }
  return endpointSet;
}

/**
 * Extracts all web routes declared in apps/web/src/App.tsx.
 */
function extractWebRoutes(): Set<string> {
  const appTsxPath = path.resolve(process.cwd(), 'apps/web/src/App.tsx');
  const content = fs.readFileSync(appTsxPath, 'utf8');

  const registeredRoutes = new Set<string>();

  // Regex match <Route path="..." ... />
  // Also account for nested routes under <Route path="/app" ...>
  let inAppBlock = false;

  const lines = content.split('\n');
  for (const line of lines) {
    if (line.includes('path="/app"')) {
      inAppBlock = true;
      continue;
    }
    if (inAppBlock && line.includes('</Route>') && !line.includes('<Route')) {
      inAppBlock = false;
      continue;
    }

    if (inAppBlock) {
      if (line.includes('index')) {
        registeredRoutes.add('/app');
      }
      const childMatch = line.match(/path="([^"]+)"/);
      if (childMatch) {
        const subPath = childMatch[1];
        registeredRoutes.add(`/app/${subPath}`);
      }
    } else {
      const topMatch = line.match(/path="([^"]+)"/);
      if (topMatch) {
        registeredRoutes.add(topMatch[1]);
      }
    }
  }

  return registeredRoutes;
}

/**
 * Parses SPEC.md Section 12 table to extract expected API routes.
 */
function parseSpecApiRoutes(): Array<{ method: string; path: string; purpose: string }> {
  const specPath = path.resolve(process.cwd(), 'docs/SPEC.md');
  const content = fs.readFileSync(specPath, 'utf8');
  const lines = content.split('\n');

  let inSection12 = false;
  const specRoutes: Array<{ method: string; path: string; purpose: string }> = [];

  for (const line of lines) {
    if (line.startsWith('## 12. Backend API Routes')) {
      inSection12 = true;
      continue;
    }
    if (inSection12 && line.startsWith('## 13.')) {
      inSection12 = false;
      break;
    }
    if (!inSection12) continue;

    // Table rows start with | GET | ...
    const match = line.match(
      /^\|\s*(GET|POST|PATCH|DELETE|PUT)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\s*\|/
    );
    if (match) {
      const method = match[1].toUpperCase();
      let rawPath = match[2].trim();
      const purpose = match[3].trim();

      // Normalize export format queries like /handovers/:id/export?format=md to base route /handovers/:id/export
      if (rawPath.includes('?')) {
        rawPath = rawPath.split('?')[0];
      }

      // Add /api/v1 prefix if not /health/*
      const fullPath = rawPath.startsWith('/health') ? rawPath : `/api/v1${rawPath}`;

      // De-duplicate if same method and path already recorded (e.g. export md & pdf)
      if (!specRoutes.some((r) => r.method === method && r.path === fullPath)) {
        specRoutes.push({ method, path: fullPath, purpose });
      }
    }
  }

  return specRoutes;
}

/**
 * Parses SPEC.md Section 6 table to extract expected Web routes.
 */
function parseSpecWebRoutes(): Array<{ path: string; purpose: string }> {
  const specPath = path.resolve(process.cwd(), 'docs/SPEC.md');
  const content = fs.readFileSync(specPath, 'utf8');
  const lines = content.split('\n');

  let inSection6 = false;
  const specRoutes: Array<{ path: string; purpose: string }> = [];

  for (const line of lines) {
    if (line.startsWith('## 6. Application Pages (Routes)')) {
      inSection6 = true;
      continue;
    }
    if (inSection6 && line.startsWith('## 7.')) {
      inSection6 = false;
      break;
    }
    if (!inSection6) continue;

    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+)\s*\|/);
    if (match) {
      const pathStr = match[1].trim();
      const purpose = match[2].trim();
      specRoutes.push({ path: pathStr, purpose });
    }
  }

  return specRoutes;
}

/**
 * Builds the complete feature inventory by checking the codebase.
 */
export function getFeatureInventory(): FeatureInventory {
  const expressEndpoints = extractExpressRoutes();
  const webEndpoints = extractWebRoutes();
  const specApiRoutes = parseSpecApiRoutes();
  const specWebRoutes = parseSpecWebRoutes();

  const apiRoutes: RouteItem[] = specApiRoutes.map((spec) => {
    const key = `${spec.method} ${spec.path}`;
    const isImplemented = expressEndpoints.has(key);
    return {
      method: spec.method,
      path: spec.path,
      specSection: '12',
      purpose: spec.purpose,
      status: isImplemented ? 'implemented' : 'not built',
      notes: isImplemented ? 'Registered in Express router' : 'Not registered in router',
    };
  });

  const hackathonRoutes: RouteItem[] = [
    {
      method: 'POST',
      path: '/api/v1/handovers/:id/acknowledge',
      specSection: 'Hackathon Addition 1',
      purpose: 'Acknowledge receipt of a shared handover by the designated recipient',
      status: expressEndpoints.has('POST /api/v1/handovers/:id/acknowledge')
        ? 'implemented'
        : 'not built',
      notes: 'Registered in Express router',
    },
    {
      method: 'GET',
      path: '/api/v1/projects/:id/recurring-problems',
      specSection: 'Hackathon Addition 2',
      purpose: 'Retrieve recurring problems grouped by Jaccard similarity across distinct sources',
      status: expressEndpoints.has('GET /api/v1/projects/:id/recurring-problems')
        ? 'implemented'
        : 'not built',
      notes: 'Registered in Express router',
    },
  ];
  apiRoutes.push(...hackathonRoutes);

  const webRoutes: RouteItem[] = specWebRoutes.map((spec) => {
    const isImplemented = webEndpoints.has(spec.path);
    return {
      path: spec.path,
      specSection: '6',
      purpose: spec.purpose,
      status: isImplemented ? 'implemented' : 'not built',
      notes: isImplemented ? 'Registered in React Router' : 'Not registered in React Router',
    };
  });

  const implementedApi = apiRoutes.filter((r) => r.status === 'implemented').length;
  const implementedWeb = webRoutes.filter((r) => r.status === 'implemented').length;

  return {
    generatedAt: new Date().toISOString(),
    apiRoutes,
    webRoutes,
    summary: {
      totalApi: apiRoutes.length,
      implementedApi,
      notBuiltApi: apiRoutes.length - implementedApi,
      totalWeb: webRoutes.length,
      implementedWeb,
      notBuiltWeb: webRoutes.length - implementedWeb,
    },
  };
}

export function isApiRouteImplemented(method: string, path: string): boolean {
  const inv = getFeatureInventory();
  const found = inv.apiRoutes.find(
    (r) => r.method?.toUpperCase() === method.toUpperCase() && r.path === path
  );
  return found?.status === 'implemented';
}

export function isWebRouteImplemented(path: string): boolean {
  const inv = getFeatureInventory();
  const found = inv.webRoutes.find((r) => r.path === path);
  return found?.status === 'implemented';
}

function generateMarkdownReport(inv: FeatureInventory): string {
  let md = `# Relay Feature Inventory\n\n`;
  md += `**Generated:** ${inv.generatedAt}  \n`;
  md += `**Methodology:** Dynamically extracted from Express router (\`apps/api/src/app.ts\`) and React Router (\`apps/web/src/App.tsx\`), matched against [docs/SPEC.md](file:///home/shubham/Relay/docs/SPEC.md) Sections 6 & 12.\n\n`;

  md += `## Summary\n\n`;
  md += `| Category | Total Defined | Implemented | Not Built Yet | Coverage |\n`;
  md += `| --- | --- | --- | --- | --- |\n`;
  md += `| **API Routes (Section 12)** | ${inv.summary.totalApi} | ${inv.summary.implementedApi} | ${inv.summary.notBuiltApi} | ${Math.round((inv.summary.implementedApi / inv.summary.totalApi) * 100)}% |\n`;
  md += `| **Web Routes (Section 6)** | ${inv.summary.totalWeb} | ${inv.summary.implementedWeb} | ${inv.summary.notBuiltWeb} | ${Math.round((inv.summary.implementedWeb / inv.summary.totalWeb) * 100)}% |\n\n`;

  md += `## 1. Backend API Routes (Section 12)\n\n`;
  md += `| Method | Path | Spec Purpose | Status | Notes |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const r of inv.apiRoutes) {
    const statusBadge = r.status === 'implemented' ? '✅ **implemented**' : '❌ **not built**';
    md += `| \`${r.method}\` | \`${r.path}\` | ${r.purpose} | ${statusBadge} | ${r.notes || ''} |\n`;
  }

  md += `\n## 2. Web Application Routes (Section 6)\n\n`;
  md += `| Path | Spec Purpose | Status | Notes |\n`;
  md += `|---|---|---|---|\n`;
  for (const r of inv.webRoutes) {
    const statusBadge = r.status === 'implemented' ? '✅ **implemented**' : '❌ **not built**';
    md += `| \`${r.path}\` | ${r.purpose} | ${statusBadge} | ${r.notes || ''} |\n`;
  }

  md += `\n## 3. Not Built Features\n\n`;
  const notBuiltApi = inv.apiRoutes.filter((r) => r.status === 'not built');
  const notBuiltWeb = inv.webRoutes.filter((r) => r.status === 'not built');

  if (notBuiltApi.length === 0 && notBuiltWeb.length === 0) {
    md += `None. All defined routes are built.\n`;
  } else {
    if (notBuiltApi.length > 0) {
      md += `### API Routes Not Built:\n`;
      for (const r of notBuiltApi) {
        md += `- \`${r.method} ${r.path}\`: ${r.purpose}\n`;
      }
    }
    if (notBuiltWeb.length > 0) {
      md += `### Web Routes Not Built:\n`;
      for (const r of notBuiltWeb) {
        md += `- \`${r.path}\`: ${r.purpose}\n`;
      }
    }
  }

  return md;
}

export function run(): void {
  const inv = getFeatureInventory();
  const md = generateMarkdownReport(inv);
  const outPath = path.resolve(process.cwd(), 'docs/feature-inventory.md');
  fs.writeFileSync(outPath, md, 'utf8');

  console.log(`[Feature Inventory] Generated ${outPath}`);
  console.log(
    `API Routes: ${inv.summary.implementedApi}/${inv.summary.totalApi} implemented (${inv.summary.notBuiltApi} not built)`
  );
  console.log(
    `Web Routes: ${inv.summary.implementedWeb}/${inv.summary.totalWeb} implemented (${inv.summary.notBuiltWeb} not built)`
  );
}

// Execute when invoked directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  run();
}
