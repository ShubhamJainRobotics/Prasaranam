import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  createOrgSchema,
  addOrgMemberSchema,
  updateOrgMemberSchema,
  createProjectSchema,
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberSchema,
} from '../src/index.js';

describe('Contracts Schemas', () => {
  describe('Auth Schemas', () => {
    it('validates register input', () => {
      const valid = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
        displayName: 'Alice User',
      });
      expect(valid.success).toBe(true);

      const invalidEmail = registerSchema.safeParse({
        email: 'not-an-email',
        password: 'password123',
        displayName: 'Alice',
      });
      expect(invalidEmail.success).toBe(false);

      const shortPassword = registerSchema.safeParse({
        email: 'user@example.com',
        password: '123',
        displayName: 'Alice',
      });
      expect(shortPassword.success).toBe(false);

      const emptyName = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
        displayName: ' ',
      });
      expect(emptyName.success).toBe(false);
    });

    it('validates login input', () => {
      expect(
        loginSchema.safeParse({ email: 'user@example.com', password: 'secretpassword' }).success
      ).toBe(true);
      expect(
        loginSchema.safeParse({ email: 'bad-email', password: 'secretpassword' }).success
      ).toBe(false);
      expect(loginSchema.safeParse({ email: 'user@example.com', password: '' }).success).toBe(
        false
      );
    });

    it('validates forgot and reset password inputs', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
      expect(forgotPasswordSchema.safeParse({ email: 'bad' }).success).toBe(false);

      expect(resetPasswordSchema.safeParse({ password: 'securePassword123' }).success).toBe(true);
      expect(resetPasswordSchema.safeParse({ password: 'short' }).success).toBe(false);
    });

    it('validates update profile input', () => {
      expect(updateProfileSchema.safeParse({ displayName: 'New Name' }).success).toBe(true);
      expect(updateProfileSchema.safeParse({ displayName: '' }).success).toBe(false);
    });
  });

  describe('Organisation Schemas', () => {
    it('validates create organisation input', () => {
      expect(createOrgSchema.safeParse({ name: 'Acme Corp' }).success).toBe(true);
      expect(createOrgSchema.safeParse({ name: 'A' }).success).toBe(false);
      expect(createOrgSchema.safeParse({ name: '' }).success).toBe(false);
    });

    it('validates add organisation member input', () => {
      expect(
        addOrgMemberSchema.safeParse({ email: 'colleague@example.com', role: 'admin' }).success
      ).toBe(true);
      expect(
        addOrgMemberSchema.safeParse({ email: 'colleague@example.com', role: 'invalid_role' })
          .success
      ).toBe(false);
      expect(addOrgMemberSchema.safeParse({ email: 'invalid_email', role: 'member' }).success).toBe(
        false
      );
    });

    it('validates update organisation member input', () => {
      expect(updateOrgMemberSchema.safeParse({ role: 'owner', active: true }).success).toBe(true);
      expect(updateOrgMemberSchema.safeParse({ role: 'owner', active: false }).success).toBe(true);
      expect(updateOrgMemberSchema.safeParse({ role: 'fake', active: true }).success).toBe(false);
    });
  });

  describe('Project Schemas', () => {
    it('validates create project input with defaults', () => {
      const res = createProjectSchema.safeParse({ name: 'Core Project' });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.domain).toBe('general');
        expect(res.data.timezone).toBe('UTC');
        expect(res.data.description).toBe('');
      }
    });

    it('validates update project input', () => {
      expect(
        updateProjectSchema.safeParse({ name: 'Updated Name', domain: 'software_engineering' })
          .success
      ).toBe(true);
      expect(updateProjectSchema.safeParse({ name: 'x' }).success).toBe(false);
    });

    it('validates add project member input', () => {
      expect(
        addProjectMemberSchema.safeParse({ email: 'analyst@example.com', role: 'contributor' })
          .success
      ).toBe(true);
      expect(
        addProjectMemberSchema.safeParse({ email: 'analyst@example.com', role: 'reviewer' }).success
      ).toBe(true);
      expect(
        addProjectMemberSchema.safeParse({ email: 'analyst@example.com', role: 'recipient' })
          .success
      ).toBe(true);
      expect(
        addProjectMemberSchema.safeParse({ email: 'analyst@example.com', role: 'owner' }).success
      ).toBe(true);
      expect(
        addProjectMemberSchema.safeParse({ email: 'analyst@example.com', role: 'invalid' }).success
      ).toBe(false);
    });

    it('validates update project member input', () => {
      expect(updateProjectMemberSchema.safeParse({ role: 'reviewer', active: true }).success).toBe(
        true
      );
      expect(
        updateProjectMemberSchema.safeParse({ role: 'contributor', active: false }).success
      ).toBe(true);
      expect(updateProjectMemberSchema.safeParse({ role: 'unknown', active: true }).success).toBe(
        false
      );
    });
  });
});
