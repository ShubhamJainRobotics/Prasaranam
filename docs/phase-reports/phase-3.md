# Phase 3 Report: Authentication and Workspace UI

## 1. Implemented

- **Authentication Middleware & Authorization Engine**:
  - Bearer-token authentication middleware (`apps/api/src/middleware/auth.ts`) validating tokens server-side via Supabase Auth `getUser()`, enforcing confirmed emails (`email_confirmed_at IS NOT NULL`), loading active memberships dynamically from `organisation_members` and `project_members`, and populating `req.user`.
  - Central action-based authorization matrix (`apps/api/src/auth/authorisation.ts`) implementing actions `ORG_VIEW`, `ORG_MANAGE_MEMBERS`, `ORG_CREATE_PROJECT`, `PROJECT_VIEW`, `PROJECT_EDIT_SETTINGS`, `PROJECT_MANAGE_MEMBERS`, and `PROJECT_VIEW_DASHBOARD`, with strict non-disclosure semantics (returning 404 for invisible resources and 403 for insufficient privileges).
- **Backend API Routes (`apps/api/src/routes/`)**:
  - `GET /api/v1/me`: Returns current user details, display name, and active organisation and project memberships.
  - `PATCH /api/v1/me`: Updates display name in `public.profiles`.
  - `POST /api/v1/organisations`: Bootstraps organisation and owner membership in a single transaction via Phase 2 `bootstrapOrganisation` database function.
  - `GET /api/v1/organisations`: Returns cursor-paginated list of accessible organisations.
  - `GET /api/v1/organisations/:id/members`: Lists organisation members with pagination; exposes email addresses only to organisation owners and admins.
  - `POST /api/v1/organisations/:id/members`: Adds verified existing account using constant-time non-enumerating behavior.
  - `PATCH /api/v1/organisations/:id/members/:userId`: Updates member role/active state, enforcing last-owner protection (409 Conflict).
  - `POST /api/v1/organisations/:id/projects`: Creates a new project in the organisation with owner membership.
  - `GET /api/v1/organisations/:id/projects`: Lists accessible projects in the organisation (owners/admins see all; members see projects where they are an active member).
  - `GET /api/v1/projects/:id`: Returns project summary and current user role.
  - `PATCH /api/v1/projects/:id`: Updates project settings (name, description, domain, timezone).
  - `GET /api/v1/projects/:id/members`: Lists accessible project members with cursor pagination; exposes email only to project owners.
  - `POST /api/v1/projects/:id/members`: Adds an existing organisation member to the project with constant-time non-enumerating behavior.
  - `PATCH /api/v1/projects/:id/members/:userId`: Changes project member role or active state, enforcing last-owner protection.
  - `GET /api/v1/projects/:id/dashboard`: Returns project info, member count, and zeroed summary counts for sources, claims, questions, and handovers.
- **Frontend Workspace & Section 17 Components (`apps/web/src/`)**:
  - `Supabase Client`: Initialized strictly for Supabase Auth.
  - `API Client`: Typesafe `apiFetch` and `apiFetchPaginated` with automatic Bearer token injection and error unwrapping.
  - `Context Providers`: `AuthProvider` (auth state, login, register, logout, password reset) and `ToastProvider` (accessible status live region).
  - `Layout & Navigation Components`: `AppShell`, `Sidebar`, `Topbar`, `Breadcrumbs`, `PageHeader`, `OrganisationSwitcher`, `ProjectSwitcher`.
  - `Security & Feedback Components`: `ProtectedRoute`, `RoleGate`, `ConfirmDialog`, `EmptyState`, `LoadingSkeleton`, `ErrorState`, `ForbiddenState`.
  - `Project Components`: `ProjectCard`, `ProjectMembersTable`, `ProjectSettingsForm`, `CreateProjectDialog`, `AddProjectMemberDialog`.
  - `Organisation Components`: `CreateOrgDialog`, `AddOrgMemberDialog`.
  - `Pages`:
    - `/` (`LandingPage.tsx` with active Link routing to `/register` and `/login`)
    - `/login` (`LoginPage.tsx`)
    - `/register` (`RegisterPage.tsx` with required display name and confirmation prompt)
    - `/forgot-password` (`ForgotPasswordPage.tsx`)
    - `/reset-password` (`ResetPasswordPage.tsx`)
    - `/auth/callback` (`AuthCallbackPage.tsx` with app origin redirect validation)
    - `/app` (`AppEntryPage.tsx` redirecting to existing org or onboarding empty state)
    - `/app/organisations/:organisationId` (`OrganisationOverviewPage.tsx`)
    - `/app/organisations/:organisationId/members` (`OrganisationMembersPage.tsx`)
    - `/app/projects/:projectId` (`ProjectDashboardPage.tsx`)
    - `/app/projects/:projectId/members` (`ProjectMembersPage.tsx`)
    - `/app/projects/:projectId/settings` (`ProjectSettingsPage.tsx`)
    - `/app/settings` (`AccountSettingsPage.tsx` for display name and password change)
    - `*` (`NotFoundPage.tsx`)
- **Shared Contracts (`packages/contracts/src/`)**:
  - Zod schemas and TypeScript types for auth, organisations, projects, enums, envelopes, and pagination.
  - Regenerated 34 committed JSON schemas via `npm run schemas:generate`.

## 2. Commands Run

- `npm run schemas:generate`: **passed**
- `npm run typecheck`: **passed**
- `npm run lint`: **passed**
- `npm run format`: **passed**
- `npm run format:check`: **passed**
- `npm run test`: **passed** (2 test suites, 25 tests)
- `npm run test:integration`: **passed** (5 test suites, 37 tests)
- `npm run test:security`: **passed** (8 test suites, 49 tests)
- `npm run test:e2e`: **passed** (2 test suites, 3 tests)
- `npm run build`: **passed** (all 6 workspaces built successfully)

## 3. Exit Criteria

- **A verified account can create and navigate the workspace**: **met**
  - Proved by `tests/e2e/auth-workspace.spec.ts` (user registers, confirms email via Mailpit, creates organisation, creates project, and navigates dashboard).
- **Removed members lose access immediately**: **met**
  - Proved by `tests/e2e/auth-workspace.spec.ts` (member removed by owner immediately receives 404 from API and UI renders "Page not found") and `tests/security/auth-guards.test.ts`.
- **Unauthenticated users cannot reach /app routes**: **met**
  - Proved by `tests/security/auth-guards.test.ts` (401 returned for missing or invalid tokens) and `apps/web/src/components/auth/ProtectedRoute.tsx`.
- **The landing-page buttons navigate to /register and /login without showing the not-found page**: **met**
  - Proved by `tests/e2e/auth-workspace.spec.ts` and `tests/e2e/landing.spec.ts`.
- **API security controls and non-enumeration semantics**: **met**
  - Proved by `tests/security/auth-guards.test.ts` (401 for unconfirmed emails, rejection of forged body actor fields, 404 non-disclosure for inaccessible/cross-tenant resources, constant-time identical responses for member addition).
- **Production web build contains no service-role key or Gemini key**: **met**
  - Proved by `tests/security/auth-guards.test.ts` verifying `apps/web/dist/` bundle assets.

## 4. Decisions and Spec Issues Recorded

- Recorded in `docs/decisions.md`:
  - **`@hookform/resolvers` Version Alignment**: Used `@hookform/resolvers@3.10.0` to match `zod@3.24.2` types.
  - **Tree-Shaking Server Credentials**: Added `"sideEffects": false` in `packages/contracts/package.json` to ensure server schemas (`serverEnvironmentSchema`) are tree-shaken out of the web client bundle.
  - **Supabase Auth Redirect Configuration**: Configured `site_url = "http://127.0.0.1:5173"` and `additional_redirect_urls` in `supabase/config.toml` so confirmation and recovery emails link directly to `/auth/callback` on the Vite dev server.
  - **Project Listing Route**: Implemented `GET /organisations/:id/projects` enforcing Section 2A.2 rules (owners/admins see all projects in the org; members see projects where they are active members).
  - **Symmetrical Optional Member Update Schemas**: Defined both `role` and `active` as optional in `updateProjectMemberSchema` matching `updateOrgMemberSchema`.
- Spec issues: None identified. All constraints followed the safer, more restrictive reading.

## 5. Known Limitations

- Clarification questions, sources, claims, and handovers counts on the project dashboard are zeroed, as their extraction and generation loops are slated for Phases 4 and 5.
- Real Gemini inference is not invoked in Phase 3 tests (automated test suites run with fake/deterministic providers per Section 2A.12).
