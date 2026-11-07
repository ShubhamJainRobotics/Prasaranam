import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof UuidSchema>;

export const PaginationQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'Cursor must be base64url encoded')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
