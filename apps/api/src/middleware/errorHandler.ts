import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { ErrorEnvelope, ErrorDetail } from '@relay/contracts';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const requestId = String(req.id || 'unknown');

  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    const envelope: ErrorEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request failed validation checks.',
        details,
      },
      requestId,
    };
    res.status(422).json(envelope);
    return;
  }

  if (
    err.type === 'entity.too.large' ||
    err.status === 413 ||
    err.code === 'LIMIT_FILE_SIZE' ||
    err.code === 'LIMIT_FILE_COUNT'
  ) {
    const envelope: ErrorEnvelope = {
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Payload size exceeds the permitted limit.',
        details: [],
      },
      requestId,
    };
    res.status(413).json(envelope);
    return;
  }

  if (err.name === 'MulterError') {
    const envelope: ErrorEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message || 'File upload error.',
        details: [],
      },
      requestId,
    };
    res.status(422).json(envelope);
    return;
  }

  if (err.name === 'IngestionError') {
    const statusCode = err.status || 422;
    const envelope: ErrorEnvelope = {
      error: {
        code: err.code || 'VALIDATION_ERROR',
        message: err.message,
        details: [],
      },
      requestId,
    };
    res.status(statusCode).json(envelope);
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    const envelope: ErrorEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Malformed JSON payload.',
        details: [],
      },
      requestId,
    };
    res.status(422).json(envelope);
    return;
  }

  const statusCode =
    typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 500;

  const code = err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';
  const message =
    statusCode >= 500
      ? 'An internal server error occurred.'
      : err.message || 'The request could not be completed.';

  const envelope: ErrorEnvelope = {
    error: {
      code,
      message,
      details: Array.isArray(err.details) ? err.details : [],
    },
    requestId,
  };

  res.status(statusCode).json(envelope);
}
