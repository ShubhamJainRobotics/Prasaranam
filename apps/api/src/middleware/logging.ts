import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import type { RequestHandler } from 'express';
import type { ServerEnvironment } from '@relay/contracts';

export function createLoggingMiddleware(env: ServerEnvironment): RequestHandler {
  const logger = pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.apikey',
        'req.headers["apikey"]',
        'password',
        '*.password',
        '*.*.password',
        'token',
        '*.token',
        '*.*.token',
        'secret',
        '*.secret',
        '*.*.secret',
        'key',
        '*.key',
        '*.*.key',
      ],
      censor: '[REDACTED]',
    },
  });

  return pinoHttp({
    logger,
    genReqId: (req) => (req as any).id || (req.headers['x-request-id'] as string),
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}
