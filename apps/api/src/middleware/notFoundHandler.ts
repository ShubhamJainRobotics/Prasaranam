import type { Request, Response } from 'express';
import type { ErrorEnvelope } from '@relay/contracts';

export function notFoundHandler(req: Request, res: Response): void {
  const envelope: ErrorEnvelope = {
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      details: [],
    },
    requestId: String(req.id || 'unknown'),
  };
  res.status(404).json(envelope);
}
