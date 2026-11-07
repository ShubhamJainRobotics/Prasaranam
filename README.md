# Relay

> AI-Powered Project Knowledge Handover Platform

Relay converts scattered, authorised project activity into evidence-backed, human-reviewed, recipient-specific knowledge handovers.

## Prerequisites

- **Node.js**: `v24.x` (LTS)
- **npm**: `v12.x`
- **Docker Engine**: running locally with non-root access
- **Supabase CLI**: installed locally or accessible via `npx supabase`

## Architecture Overview

The repository is organized as an npm workspaces monorepo:

- `apps/web`: React 19 single-page application with Vite, React Router, Tailwind CSS, TanStack Query, and WCAG AA accessible design tokens.
- `apps/api`: Express.js backend with strict CORS allowlist, Helmet security headers, Pino structured logging with redaction, body limits, express-rate-limit, and root health routes (`/health/live`, `/health/ready`).
- `apps/worker`: Background job worker skeleton with environment validation, database pool lifecycle, and graceful SIGTERM handling.
- `packages/contracts`: Shared Zod schemas, types, error codes, and strict environment validation rules.
- `packages/database`: PostgreSQL client pool factory (`pg`) and readiness health checks.
- `packages/test-fixtures`: Reusable test environments and mocks.
- `scripts/`: Local orchestration and validation utilities (`bootstrap-local.ts`, `verify-environment.ts`, `generate-json-schemas.ts`).

## Verified Commands

```bash
# Install dependencies
npm install

# TypeScript typecheck
npm run typecheck

# Linting
npm run lint

# Code formatting check
npm run format:check

# Unit tests (Vitest)
npm run test

# Integration tests (Supertest against API factory)
npm run test:integration

# Security tests (environment guards and constraints)
npm run test:security

# End-to-end tests (Playwright)
npm run test:e2e

# JSON schema generation (deterministic)
npm run schemas:generate

# Build all packages and applications
npm run build

# Start local Supabase stack
npm run db:start

# Bootstrap local environment files (.env and apps/web/.env.local)
npm run bootstrap:local

# Verify environment variables
npm run verify:env

# Start development services (API, Worker, Web)
npm run dev

# Stop local Supabase stack
npm run db:stop
```
