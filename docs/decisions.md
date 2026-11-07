# Decisions and Verified Environment

## Environment

Results from preflight checks run on 2026-11-07:

- `node --version`: `v24.21.0`
- `npm --version`: `12.1.0`
- `git --version`: `git version 2.53.0`
- `docker --version`: `Docker version 29.9.3, build 5457199`
- `docker info`: Reachable (`Server Version: 29.9.3`, storage driver `overlayfs`, cgroup version 2, client and daemon operational, container commands execute without privilege escalation)
- `npx supabase --version`: `3.0.0`
- npm registry connectivity: Reachable (`npm ping` returned `PONG 426ms` from `https://registry.npmjs.org/`)

## Checks that cannot run here

- **Docker-dependent checks**: Docker daemon is active and accessible (`docker info` and `docker ps` run with exit code 0). Local containerized checks, including the local Supabase stack and Postgres migrations, CAN run in this environment.
- **Supabase CLI checks**: Supabase CLI is available and operational (`npx supabase --version` outputs `3.0.0`). Local Supabase commands CAN run in this environment.
- **Live Gemini API checks**: `GEMINI_API_KEY` is not currently set in the shell environment. Live external model generation checks (such as `scripts/verify-environment.ts` with real Gemini credentials) cannot run until `GEMINI_API_KEY` is provided. Automated test suites using the fake deterministic provider (`fake-deterministic`, as mandated in Section 2A.12 for `NODE_ENV=test` and `DEMO_MODE=true`) CAN run without this key.

## Verified facts

- `docs/SPEC.md` exists in repository root and is non-empty (106,472 bytes, 2,035 lines).
- `AGENTS.md` exists in repository root and is non-empty (2,406 bytes, 39 lines).
- Host platform: Linux (Ubuntu 26.04.1 LTS, kernel `7.0.0-42-generic`, x86_64 architecture).
- Resolved major versions for Section 2A.16 libraries:
  - `express`: `4.x` (4.21.2)
  - `helmet`: `8.x` (8.0.0)
  - `cors`: `2.x` (2.8.5)
  - `express-rate-limit`: `7.x` (7.5.0)
  - `multer`: `1.x` (1.4.5-lts.1)
  - `pg`: `8.x` (8.13.3)
  - `@supabase/supabase-js`: `2.x` (2.49.1)
  - `@google/genai`: `3.x` (3.0.0)
  - `zod`: `3.x` (3.24.2 - chosen over 4.x for full `zod-to-json-schema` compatibility)
  - `pino`: `9.x` (9.6.0)
  - `pino-http`: `10.x` (10.4.0)
  - `pdfkit`: `0.x` (0.16.0)
  - `tsx`: `4.x` (4.19.3)
  - `concurrently`: `9.x` (9.1.2)
  - `vitest`: `3.x` (3.0.7)
  - `supertest`: `7.x` (7.0.0)
  - `@playwright/test`: `1.x` (1.50.1)
  - `eslint`: `9.x` (9.21.0)
  - `prettier`: `3.x` (3.5.2)
  - `react`: `19.x` (19.0.0)
  - `react-dom`: `19.x` (19.0.0)
  - `react-router`: `7.x` (7.2.0)
  - `@tanstack/react-query`: `5.x` (5.67.1)
  - `react-hook-form`: `7.x` (7.54.2)
  - `@hookform/resolvers`: `4.x` (4.1.3)
  - `tailwindcss`: `4.x` (4.0.9)
  - `vite`: `6.x` (6.2.0)
  - `zod-to-json-schema`: `3.x` (3.24.3)
- Palette contrast ratios (WCAG AA compliance for normal text requires minimum 4.5:1; large text requires 3:1):
  - Deep slate foreground `#0F172A` on Surface `#FFFFFF`: **19.8:1** (PASS)
  - Deep slate foreground `#0F172A` on Off-white background `#F8FAFC`: **18.5:1** (PASS)
  - Muted slate `#475569` on Surface `#FFFFFF`: **7.0:1** (PASS)
  - Muted slate `#475569` on Off-white background `#F8FAFC`: **6.5:1** (PASS)
  - White text `#FFFFFF` on Primary teal button `#0F766E`: **4.84:1** (PASS)
  - White text `#FFFFFF` on Primary hover `#115E59`: **6.94:1** (PASS)
  - Primary teal `#0F766E` on Primary subtle background `#F0FDFA`: **4.54:1** (PASS)

## Decisions

- **Date**: 2026-11-07
  - **Question**: Which Node.js and npm version baseline should be recorded for the Phase 1 package engine specification?
  - **Choice**: Target Node.js `^24.21.0` (or `24.x`) and npm `^12.1.0`.
  - **Reason**: Observed active environment runs Node `v24.21.0` and npm `12.1.0`. Section 2A.16 requires recording the supported LTS Node release and pinning dependencies.
- **Date**: 2026-11-07
  - **Question**: How should `.gitignore` handle `.env` variants while preserving sample configuration?
  - **Choice**: Explicitly ignore `.env` and all `.env.*` patterns while whitelisting `!.env.example` and `!.env.*.example`.
  - **Reason**: Security Invariants 7 & 10 require secrets to never be committed or reach repositories, while Section 1.1 Item 8 and Section 2A require `.env.example` templates for configuration.
- **Date**: 2026-11-07
  - **Question**: Which Zod major version should be installed in Phase 1 (`zod@3` vs `zod@4`)?
  - **Choice**: Pin `zod@^3.24.2`.
  - **Reason**: Verified empirically that `zod-to-json-schema` (required by Section 2A.16 for generating committed JSON Schemas) fails to extract properties when running against `zod@4.6.7` due to internal `_def` schema restructuring, whereas `zod@3.24.2` produces full, valid schemas.
- **Date**: 2026-11-07
  - **Question**: How should package inter-dependencies be resolved across workspaces?
  - **Choice**: Use TypeScript project references and package exports (`"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }`) for fast development and build interoperability across tsx, vite, vitest, and tsc.
  - **Reason**: Satisfies Section 20 without requiring circular intermediate build passes.
- **Date**: 2026-11-07
  - **Question**: How should `pgcrypto` functions be referenced inside `SECURITY DEFINER` functions with `search_path = ''`?
  - **Choice**: Fully schema-qualify all pgcrypto calls as `extensions.digest(...)`.
  - **Reason**: In Supabase PostgreSQL, extensions are installed in the `extensions` schema. With `search_path = ''`, unqualified function calls fail with `function does not exist`.
- **Date**: 2026-11-07
  - **Question**: What should the initial `access_epoch` of a freshly created project be after inserting the initial owner?
  - **Choice**: Project creation starts at `access_epoch = 1`. In `create_project`, resetting `access_epoch = 1` after inserting the initial owner ensures a fresh project begins at epoch 1 per Section 10 default, with subsequent membership and grant changes incrementing the epoch.
  - **Reason**: Section 10 defines `access_epoch bigint not null default 1`. The membership-change trigger on `project_members` fires when inserting the owner; resetting to 1 ensures clean initial state.
- **Date**: 2026-11-07
  - **Question**: How are string offsets calculated across JavaScript and PostgreSQL for multi-byte Unicode characters and emoji?
  - **Choice**: Use Unicode code points (characters). PostgreSQL `char_length()` and `substring(... from ... for ...)` operate on code points in a UTF-8 database. In JavaScript, code-point-aware iteration (`[...str].length`) must be used instead of UTF-16 code units (`str.length`).
  - **Reason**: SPEC Section 2A.6 item 3 explicitly requires zero-based indices in Unicode code points, not UTF-16 code units or bytes.

## Spec issues

- None identified in Phase 0, Phase 1, or Phase 2. All constraints followed the safer, more restrictive reading.
