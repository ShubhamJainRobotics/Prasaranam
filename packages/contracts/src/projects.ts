import { z } from 'zod';
import { ProjectRoleSchema, ProjectDomainSchema } from './enums.js';

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(3000).default(''),
  domain: ProjectDomainSchema.default('general'),
  timezone: z.string().trim().min(1).default('UTC'),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(3000).optional(),
  domain: ProjectDomainSchema.optional(),
  timezone: z.string().trim().min(1).optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const addProjectMemberSchema = z.object({
  email: z.string().trim().email(),
  role: ProjectRoleSchema,
});

export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const updateProjectMemberSchema = z.object({
  role: ProjectRoleSchema.optional(),
  active: z.boolean().optional(),
});

export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberSchema>;
