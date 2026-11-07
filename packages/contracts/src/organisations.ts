import { z } from 'zod';
import { OrganisationRoleSchema } from './enums.js';

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const addOrgMemberSchema = z.object({
  email: z.string().trim().email(),
  role: OrganisationRoleSchema,
});

export type AddOrgMemberInput = z.infer<typeof addOrgMemberSchema>;

export const updateOrgMemberSchema = z.object({
  role: OrganisationRoleSchema,
  active: z.boolean(),
});

export type UpdateOrgMemberInput = z.infer<typeof updateOrgMemberSchema>;
