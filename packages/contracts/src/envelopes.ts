import { z } from 'zod';
import { ErrorCodeSchema } from './errors.js';

export const createSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    requestId: z.string(),
  });

export const ErrorDetailSchema = z.object({
  path: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.array(ErrorDetailSchema).default([]),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ErrorEnvelopeSchema = z.object({
  error: ErrorBodySchema,
  requestId: z.string(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const PageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

export const createPaginatedEnvelopeSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    page: PageInfoSchema,
    requestId: z.string(),
  });
