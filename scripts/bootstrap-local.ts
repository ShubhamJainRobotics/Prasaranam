import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function runBootstrap() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run bootstrap script in production (Section 2A.15)');
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  const rootEnvPath = path.resolve(process.cwd(), '.env');
  const webEnvPath = path.resolve(process.cwd(), 'apps/web/.env.local');

  if (!force && (fs.existsSync(rootEnvPath) || fs.existsSync(webEnvPath))) {
    console.log(
      'Environment files (.env or apps/web/.env.local) already exist. Pass --force to overwrite.'
    );
    return;
  }

  let statusOutput: string;
  try {
    statusOutput = execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    console.error(
      'Failed to query Supabase status. Make sure Supabase is running with "npm run db:start".'
    );
    process.exit(1);
  }

  let statusJson: Record<string, any>;
  try {
    statusJson = JSON.parse(statusOutput);
  } catch {
    console.error('Failed to parse Supabase CLI JSON status output');
    process.exit(1);
  }

  // Handle various casing styles that different Supabase CLI versions might output
  const apiUrl =
    statusJson.API_URL || statusJson.apiUrl || statusJson['api.url'] || statusJson.api?.url;

  const anonKey =
    statusJson.ANON_KEY ||
    statusJson.anonKey ||
    statusJson['auth.anon_key'] ||
    statusJson.auth?.anon_key;

  const serviceRoleKey =
    statusJson.SERVICE_ROLE_KEY ||
    statusJson.serviceRoleKey ||
    statusJson['auth.service_role_key'] ||
    statusJson.auth?.service_role_key;

  const dbUrl = statusJson.DB_URL || statusJson.dbUrl || statusJson['db.url'] || statusJson.db?.url;

  if (!apiUrl || !anonKey || !serviceRoleKey || !dbUrl) {
    console.error('Supabase status output is missing required connection fields.');
    process.exit(1);
  }

  // Validate local host invariant (Section 2A.15)
  try {
    const parsedApiUrl = new URL(apiUrl);
    const host = parsedApiUrl.hostname;
    const allowedHosts = ['127.0.0.1', 'localhost', 'host.docker.internal'];
    if (!allowedHosts.includes(host)) {
      console.error(
        `Refusing to bootstrap non-local Supabase host: ${host} (allowed: ${allowedHosts.join(', ')})`
      );
      process.exit(1);
    }
  } catch {
    console.error('Invalid Supabase API URL format');
    process.exit(1);
  }

  // Read root .env.example
  const examplePath = path.resolve(process.cwd(), '.env.example');
  let rootContent = fs.readFileSync(examplePath, 'utf8');

  rootContent = rootContent
    .replace(/^SUPABASE_URL=.*$/m, `SUPABASE_URL=${apiUrl}`)
    .replace(/^SUPABASE_ANON_KEY=.*$/m, `SUPABASE_ANON_KEY=${anonKey}`)
    .replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`)
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dbUrl}`);

  fs.writeFileSync(rootEnvPath, rootContent, { mode: 0o600 });

  // Read web .env.example
  const webExamplePath = path.resolve(process.cwd(), 'apps/web/.env.example');
  let webContent = fs.readFileSync(webExamplePath, 'utf8');

  webContent = webContent
    .replace(/^VITE_SUPABASE_URL=.*$/m, `VITE_SUPABASE_URL=${apiUrl}`)
    .replace(/^VITE_SUPABASE_ANON_KEY=.*$/m, `VITE_SUPABASE_ANON_KEY=${anonKey}`);

  fs.writeFileSync(webEnvPath, webContent, { mode: 0o600 });

  console.log('Successfully wrote .env and apps/web/.env.local from local Supabase instance.');
}

runBootstrap();
