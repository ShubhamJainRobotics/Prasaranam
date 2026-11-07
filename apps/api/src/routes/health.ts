import { Router } from 'express';
import type { DbPool } from '@relay/database';
import { checkDatabaseHealth } from '@relay/database';

export function createHealthRouter(pool?: DbPool): Router {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', async (_req, res) => {
    if (!pool) {
      res.status(503).json({
        status: 'unavailable',
        message: 'Database connection pool not configured',
      });
      return;
    }

    const healthy = await checkDatabaseHealth(pool);
    if (healthy) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'unavailable',
        message: 'Database readiness check failed',
      });
    }
  });

  return router;
}
