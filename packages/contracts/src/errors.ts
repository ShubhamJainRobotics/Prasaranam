import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'STALE_CONTEXT',
  'REGENERATION_REQUIRED',
  'ACCESS_VALIDATION_FAILED',
  'LAST_OWNER',
  'ILLEGAL_STATE',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_ERROR',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
