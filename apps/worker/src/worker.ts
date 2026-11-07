import type { DbPool } from '@relay/database';
import type { ServerEnvironment } from '@relay/contracts';
import { createAiProvider, type StructuredAiProvider } from '@relay/api/ai';
import { LeaseManager } from './leasing/index.js';
import { handleExtractJob } from './handlers/extract.js';
import { handleAnalyzeRelationshipsJob } from './handlers/relationships.js';
import { handleGenerateQuestionsJob } from './handlers/questions.js';
import { pino } from 'pino';

const logger = pino({ name: 'relay-worker' });

export class RelayWorker {
  private leaseManager: LeaseManager;
  private aiProvider: StructuredAiProvider;
  private running = false;
  private activeJobs = 0;
  private workerId: string;
  private pollTimer?: NodeJS.Timeout;
  private reaperTimer?: NodeJS.Timeout;

  constructor(
    private pool: DbPool,
    private env: ServerEnvironment,
    customProvider?: StructuredAiProvider
  ) {
    this.workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.leaseManager = new LeaseManager(
      pool,
      env.JOB_LEASE_SECONDS,
      env.JOB_HEARTBEAT_SECONDS,
      env.JOB_MAX_ATTEMPTS,
      env.JOB_RETRY_BASE_SECONDS
    );
    this.aiProvider = customProvider || createAiProvider(env);
  }

  start() {
    if (this.running) return;
    this.running = true;

    logger.info(
      {
        workerId: this.workerId,
        concurrency: this.env.WORKER_CONCURRENCY,
        pollIntervalMs: this.env.WORKER_POLL_INTERVAL_MS,
      },
      'Relay worker engine started'
    );

    this.schedulePoll();

    // Schedule reaper every 60s
    this.reaperTimer = setInterval(() => {
      this.leaseManager.reapExpiredJobs().catch((err) => {
        logger.warn({ error: (err as Error).message }, 'Reaper error');
      });
    }, 60000);
  }

  private schedulePoll() {
    if (!this.running) return;
    this.pollTimer = setTimeout(async () => {
      await this.pollOnce();
      this.schedulePoll();
    }, this.env.WORKER_POLL_INTERVAL_MS);
  }

  async pollOnce(): Promise<boolean> {
    if (!this.running) return false;
    if (this.activeJobs >= this.env.WORKER_CONCURRENCY) {
      return false;
    }

    try {
      const job = await this.leaseManager.leaseNextJob(this.workerId);
      if (!job) {
        return false;
      }

      this.activeJobs++;
      this.processJob(job).finally(() => {
        this.activeJobs--;
      });

      return true;
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Error leasing job');
      return false;
    }
  }

  private async processJob(job: any) {
    const jobId = job.id;
    const lockToken = job.lock_token;

    logger.info({ jobId, kind: job.kind, attempts: job.attempts }, 'Processing leased job');

    this.leaseManager.startHeartbeat(jobId, lockToken);

    const checkCancellation = () => this.leaseManager.isCancellationRequested(jobId);

    try {
      let result: Record<string, any> = {};

      if (job.kind === 'extract') {
        result = await handleExtractJob(
          this.pool,
          this.env,
          this.aiProvider,
          job,
          checkCancellation
        );
      } else if (job.kind === 'analyze_relationships') {
        result = await handleAnalyzeRelationshipsJob(
          this.pool,
          this.env,
          this.aiProvider,
          job,
          checkCancellation
        );
      } else if (job.kind === 'generate_questions') {
        result = await handleGenerateQuestionsJob(
          this.pool,
          this.env,
          this.aiProvider,
          job,
          checkCancellation
        );
      } else {
        logger.warn({ kind: job.kind }, 'Unrecognized job kind');
        result = { status: 'skipped' };
      }

      await this.leaseManager.complete(jobId, lockToken, result);
    } catch (err: unknown) {
      const errMsg = (err as Error).message || String(err);
      let safeErrorCode = 'JOB_FAILED';

      if (errMsg.includes('CANCELLED')) {
        safeErrorCode = 'CANCELLED';
      } else if (errMsg.includes('STALE_CONTEXT')) {
        safeErrorCode = 'STALE_CONTEXT';
      } else if (errMsg.includes('QUOTA_EXCEEDED')) {
        safeErrorCode = 'QUOTA_EXCEEDED';
      } else if (errMsg.includes('VALIDATION_FAILED')) {
        safeErrorCode = 'VALIDATION_FAILED';
      }

      logger.error({ jobId, error: errMsg, safeErrorCode }, 'Job failed');
      await this.leaseManager.fail(jobId, lockToken, safeErrorCode);
    }
  }

  async stop() {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.reaperTimer) clearInterval(this.reaperTimer);
    this.leaseManager.stopAllHeartbeats();

    // Wait for active jobs to complete up to 5s
    const start = Date.now();
    while (this.activeJobs > 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    logger.info('Relay worker engine stopped');
  }
}
