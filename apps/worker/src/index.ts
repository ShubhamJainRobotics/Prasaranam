import fs from 'node:fs';
import path from 'node:path';
import { serverEnvironmentSchema } from '@relay/contracts';
import { createDbPool, closeDbPool, type DbPool } from '@relay/database';
import { RelayWorker } from './worker.js';
import { pino } from 'pino';

export * from './worker.js';
export * from './leasing/index.js';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
];
for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    if (typeof (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile === 'function') {
      (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(candidate);
    }
    break;
  }
}

const parsedEnv = serverEnvironmentSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error('[Worker Startup Error] Environment validation failed:');
  for (const issue of parsedEnv.error.issues) {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsedEnv.data;
const logger = pino({ level: env.LOG_LEVEL });

let pool: DbPool | undefined;
let worker: RelayWorker | undefined;

if (env.DATABASE_URL) {
  pool = createDbPool(env.DATABASE_URL);
  worker = new RelayWorker(pool, env);
  worker.start();
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down Relay background worker...');
  if (worker) {
    await worker.stop();
  }
  if (pool) {
    await closeDbPool(pool);
  }
  logger.info('Relay background worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
