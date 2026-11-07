import type { DbPool } from '@relay/database';
import { leaseJob, heartbeatJob, completeJob, failJob, requeueExpiredJobs } from '@relay/database';
import { pino } from 'pino';

const logger = pino({ name: 'worker-leasing' });

export class LeaseManager {
  private activeHeartbeats = new Map<string, NodeJS.Timeout>();

  constructor(
    private pool: DbPool,
    private leaseSeconds: number,
    private heartbeatSeconds: number,
    private maxAttempts: number,
    private retryBaseSeconds: number
  ) {}

  async leaseNextJob(_workerId?: string) {
    return leaseJob(this.pool, this.leaseSeconds);
  }

  startHeartbeat(jobId: string, lockToken: string) {
    if (this.activeHeartbeats.has(jobId)) {
      clearInterval(this.activeHeartbeats.get(jobId)!);
    }

    const interval = setInterval(async () => {
      try {
        await heartbeatJob(this.pool, jobId, lockToken, this.leaseSeconds);
        logger.debug({ jobId }, 'Heartbeat extended');
      } catch (err) {
        logger.warn({ jobId, error: (err as Error).message }, 'Heartbeat failed');
      }
    }, this.heartbeatSeconds * 1000);

    this.activeHeartbeats.set(jobId, interval);
  }

  stopHeartbeat(jobId: string) {
    const interval = this.activeHeartbeats.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.activeHeartbeats.delete(jobId);
    }
  }

  async complete(jobId: string, lockToken: string, result: Record<string, any>) {
    this.stopHeartbeat(jobId);
    await completeJob(this.pool, jobId, lockToken, result);
    logger.info({ jobId }, 'Job marked completed');
  }

  async fail(jobId: string, lockToken: string, errorCode: string) {
    this.stopHeartbeat(jobId);
    await failJob(this.pool, jobId, lockToken, errorCode, this.maxAttempts, this.retryBaseSeconds);
    logger.warn({ jobId, errorCode }, 'Job marked failed');
  }

  async reapExpiredJobs(): Promise<number> {
    try {
      const count = await requeueExpiredJobs(this.pool, this.maxAttempts);
      if (count > 0) {
        logger.info({ count }, 'Requeued expired jobs');
      }
      return count;
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to reap expired jobs');
      return 0;
    }
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    try {
      const res = await this.pool.query<{ cancel_requested: boolean }>(
        `SELECT cancel_requested FROM public.jobs WHERE id = $1;`,
        [jobId]
      );
      return res.rows[0]?.cancel_requested ?? false;
    } catch {
      return false;
    }
  }

  stopAllHeartbeats() {
    for (const [jobId, interval] of this.activeHeartbeats.entries()) {
      clearInterval(interval);
      this.activeHeartbeats.delete(jobId);
    }
  }
}
