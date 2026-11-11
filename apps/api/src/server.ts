import fs from 'node:fs';
import path from 'node:path';
import { serverEnvironmentSchema } from '@relay/contracts';
import { createDbPool, closeDbPool, type DbPool } from '@relay/database';
import { pino } from 'pino';
import { createApp } from './app.js';

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
  // Safe console error without echoing values
  console.error('[API Startup Error] Environment validation failed:');
  for (const issue of parsedEnv.error.issues) {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsedEnv.data;
const logger = pino({ level: env.LOG_LEVEL });

let pool: DbPool | undefined;
if (env.DATABASE_URL) {
  pool = createDbPool(env.DATABASE_URL);
}

const app = createApp({ env, pool });

let server: import('node:http').Server | undefined;
if (!process.env.VERCEL) {
  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'Relay API server started');
  });
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down Relay API server...');
  if (server) {
    server.close(async () => {
      if (pool) {
        await closeDbPool(pool);
      }
      logger.info('Relay API shutdown complete');
      process.exit(0);
    });
  } else {
    if (pool) {
      await closeDbPool(pool);
    }
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
export { app, server };

