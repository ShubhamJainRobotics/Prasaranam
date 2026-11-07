import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { ServerEnvironment } from '@relay/contracts';
import type { DbPool } from '@relay/database';
import { requestIdMiddleware } from './middleware/requestId.js';
import { createLoggingMiddleware } from './middleware/logging.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { createHealthRouter } from './routes/health.js';

export interface AppOptions {
  env: ServerEnvironment;
  pool?: DbPool;
}

export function createApp(options: AppOptions): Express {
  const { env, pool } = options;
  const app = express();

  app.set('trust proxy', 1);

  // 1. Request ID assignment
  app.use(requestIdMiddleware);

  // 2. Structured logging with redaction
  app.use(createLoggingMiddleware(env));

  // 3. Security headers via Helmet
  app.use(helmet());

  // 4. CORS with explicit allowlist
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., server-to-server, health checks, curl)
        if (!origin) return callback(null, true);
        if (env.CORS_ALLOWED_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })
  );

  // 5. Body parser with strict byte limits
  app.use(express.json({ limit: env.UPLOAD_MAX_BYTES }));

  // 6. Rate limiting
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    })
  );

  // 7. Health routes served at the root (no /api/v1 prefix)
  app.use('/health', createHealthRouter(pool));

  // 8. API v1 router
  const apiV1Router = Router();
  // Phase 1 provides empty base for later phases
  app.use('/api/v1', apiV1Router);

  // 9. 404 handler returning standard error envelope
  app.use(notFoundHandler);

  // 10. Central error handler returning standard error envelope
  app.use(errorHandler);

  return app;
}
