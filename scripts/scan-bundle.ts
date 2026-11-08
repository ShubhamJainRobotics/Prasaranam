import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const DIST_DIR = path.resolve(process.cwd(), 'apps/web/dist');

// Forbidden string identifiers that must never appear in web frontend bundles
const FORBIDDEN_LITERALS = [
  'SERVICE_ROLE',
  'GEMINI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
];

// Potential secret values from environment
const SENSITIVE_ENV_KEYS = ['SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'DATABASE_URL'];

function getSecretValues(): { key: string; value: string }[] {
  const secrets: { key: string; value: string }[] = [];
  for (const k of SENSITIVE_ENV_KEYS) {
    const val = process.env[k];
    if (val && val.trim().length >= 8) {
      secrets.push({ key: k, value: val.trim() });
    }
  }
  return secrets;
}

function getAllFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function scanBundle() {
  console.log(`Scanning production web bundle at ${DIST_DIR}...`);

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`ERROR: Bundle directory ${DIST_DIR} not found. Run 'npm run build' first.`);
    process.exit(1);
  }

  const files = getAllFiles(DIST_DIR);
  if (files.length === 0) {
    console.error(`ERROR: No files found in ${DIST_DIR}. Run 'npm run build' first.`);
    process.exit(1);
  }

  const secrets = getSecretValues();
  let totalBytes = 0;
  let violations = 0;

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    totalBytes += stat.size;

    // Only scan text-based assets
    const ext = path.extname(filePath).toLowerCase();
    if (!['.js', '.html', '.css', '.map', '.txt', '.json', '.svg'].includes(ext)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const relPath = path.relative(process.cwd(), filePath);

    // 1. Check forbidden literals
    for (const lit of FORBIDDEN_LITERALS) {
      if (content.includes(lit)) {
        console.error(`VIOLATION: Forbidden token "${lit}" detected in ${relPath}`);
        violations++;
      }
    }

    // 2. Check real secret values
    for (const s of secrets) {
      if (content.includes(s.value)) {
        console.error(`VIOLATION: Sensitive environment value for ${s.key} detected in ${relPath}`);
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.error(
      `FAIL: Bundle scanner detected ${violations} security violation(s) in apps/web/dist.`
    );
    process.exit(1);
  }

  const kb = (totalBytes / 1024).toFixed(1);
  console.log(
    `[PASS] Bundle scanner inspected ${files.length} files (${kb} KB) in apps/web/dist: zero secrets or forbidden keys detected.`
  );
  process.exit(0);
}

scanBundle();
