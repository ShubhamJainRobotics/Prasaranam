# Relay Feature Inventory

**Generated:** 2026-11-10T19:03:01.103Z  
**Methodology:** Dynamically extracted from Express router (`apps/api/src/app.ts`) and React Router (`apps/web/src/App.tsx`), matched against [docs/SPEC.md](file:///home/shubham/Relay/docs/SPEC.md) Sections 6 & 12.

## Summary

| Category                    | Total Defined | Implemented | Not Built Yet | Coverage |
| --------------------------- | ------------- | ----------- | ------------- | -------- |
| **API Routes (Section 12)** | 54            | 53          | 1             | 98%      |
| **Web Routes (Section 6)**  | 24            | 23          | 1             | 96%      |

## 1. Backend API Routes (Section 12)

| Method  | Path                                        | Spec Purpose                                                                      | Status             | Notes                        |
| ------- | ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------ | ---------------------------- |
| `GET`   | `/health/live`                              | Process liveness                                                                  | ✅ **implemented** | Registered in Express router |
| `GET`   | `/health/ready`                             | Dependency readiness without secrets                                              | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/me`                                | Current account and memberships                                                   | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/organisations`                     | Transactional bootstrap                                                           | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/organisations`                     | Accessible organisations                                                          | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/organisations/:id/members`         | Authorised membership list                                                        | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/organisations/:id/members`         | Add verified existing account                                                     | ✅ **implemented** | Registered in Express router |
| `PATCH` | `/api/v1/organisations/:id/members/:userId` | Role/active state                                                                 | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/organisations/:id/projects`        | Create project                                                                    | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id`                      | Project summary                                                                   | ✅ **implemented** | Registered in Express router |
| `PATCH` | `/api/v1/projects/:id`                      | Edit project                                                                      | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/members`              | Accessible project members                                                        | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/projects/:id/members`              | Add project member                                                                | ✅ **implemented** | Registered in Express router |
| `PATCH` | `/api/v1/projects/:id/members/:userId`      | Change role/deactivate                                                            | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/projects/:id/sources/import`       | Validated import                                                                  | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/sources`              | Accessible source metadata                                                        | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/sources/:id`                       | Accessible source                                                                 | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/sources/:id/chunks`                | Accessible evidence                                                               | ✅ **implemented** | Registered in Express router |
| `PATCH` | `/api/v1/sources/:id/access`                | Atomic permission change                                                          | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/sources/:id/archive`               | Controlled invalidation                                                           | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/projects/:id/extractions`          | Enqueue extraction                                                                | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/claims`               | Accessible filtered claims                                                        | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/claims/:id`                        | Claim and evidence                                                                | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/questions`            | Accessible clarifications                                                         | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/questions/:id/answer`              | Store answer as context source                                                    | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/projects/:id/handovers`            | Enqueue generation                                                                | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/handovers`            | Accessible versions                                                               | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/handovers/:id`                     | Authorised version                                                                | ✅ **implemented** | Registered in Express router |
| `PATCH` | `/api/v1/handovers/:id/items/:itemId`       | Review draft item                                                                 | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/handovers/:id/versions`            | Create revision                                                                   | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/handovers/:id/approve`             | Atomic approval                                                                   | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/handovers/:id/share`               | Share approved valid version                                                      | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/handovers/:id/export`              | Authenticated Markdown                                                            | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/projects/:id/conversations`        | Start private conversation                                                        | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/conversations/:id/messages`        | Current valid history                                                             | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/conversations/:id/messages`        | Evidence-grounded Q&A                                                             | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/jobs/:id`                          | Safe job status                                                                   | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/jobs/:id/retry`                    | Authorised retry                                                                  | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/audit`                | Redacted audit history                                                            | ❌ **not built**   | Not registered in router     |
| `PATCH` | `/api/v1/me`                                | Update display name                                                               | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/dashboard`            | Access-filtered dashboard summary                                                 | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/projects/:id/questions/generate`   | Enqueue clarification generation (`Idempotency-Key`)                              | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/questions/:id/dismiss`             | Dismiss a clarification question                                                  | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/claims/:id/flags`                  | Flag conflicting or doubtful evidence                                             | ✅ **implemented** | Registered in Express router |
| `PATCH` | `/api/v1/claims/:id/review`                 | Reject or restore a claim for future generation                                   | ✅ **implemented** | Registered in Express router |
| `PATCH` | `/api/v1/claims/:id/owner`                  | Link an owner label to an active project member                                   | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/handovers/:id/items`               | Add an item backed by claims readable by reviewer and recipient                   | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/handovers/:id/context`             | Add reviewer context as a source and enqueue its extraction                       | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/handovers/:id/reviews`             | Review history                                                                    | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/jobs`                 | Safe job list                                                                     | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/jobs/:id/cancel`                   | Request cancellation                                                              | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/conversations`        | Own conversations                                                                 | ✅ **implemented** | Registered in Express router |
| `POST`  | `/api/v1/handovers/:id/acknowledge`         | Acknowledge receipt of a shared handover by the designated recipient              | ✅ **implemented** | Registered in Express router |
| `GET`   | `/api/v1/projects/:id/recurring-problems`   | Retrieve recurring problems grouped by Jaccard similarity across distinct sources | ✅ **implemented** | Registered in Express router |

## 2. Web Application Routes (Section 6)

| Path                                         | Spec Purpose                    | Status             | Notes                          |
| -------------------------------------------- | ------------------------------- | ------------------ | ------------------------------ |
| `/`                                          | Product landing page            | ✅ **implemented** | Registered in React Router     |
| `/login`                                     | Login                           | ✅ **implemented** | Registered in React Router     |
| `/register`                                  | Registration                    | ✅ **implemented** | Registered in React Router     |
| `/forgot-password`                           | Password reset request          | ✅ **implemented** | Registered in React Router     |
| `/auth/callback`                             | Auth callback                   | ✅ **implemented** | Registered in React Router     |
| `/reset-password`                            | Set new password                | ✅ **implemented** | Registered in React Router     |
| `/app`                                       | Organisation/project entry      | ✅ **implemented** | Registered in React Router     |
| `/app/organisations/:organisationId`         | Organisation overview           | ✅ **implemented** | Registered in React Router     |
| `/app/organisations/:organisationId/members` | Membership administration       | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId`                   | Project dashboard               | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/members`           | Project membership and roles    | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/settings`          | Project settings and template   | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/sources`           | Source list and imports         | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/sources/:sourceId` | Authorised source viewer        | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/knowledge`         | Claims, decisions, tasks, risks | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/questions`         | Clarification questions         | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/handovers`         | Handover list                   | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/handovers/new`     | Recipient and configuration     | ✅ **implemented** | Registered in React Router     |
| `/app/handovers/:handoverId/review`          | Draft review workspace          | ✅ **implemented** | Registered in React Router     |
| `/app/handovers/:handoverId`                 | Recipient handover              | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/ask`               | Evidence-grounded Q&A           | ✅ **implemented** | Registered in React Router     |
| `/app/projects/:projectId/audit`             | Authorised audit history        | ❌ **not built**   | Not registered in React Router |
| `/app/settings`                              | Account settings                | ✅ **implemented** | Registered in React Router     |
| `*`                                          | Not-found page                  | ✅ **implemented** | Registered in React Router     |

## 3. Not Built Features

### API Routes Not Built:

- `GET /api/v1/projects/:id/audit`: Redacted audit history

### Web Routes Not Built:

- `/app/projects/:projectId/audit`: Authorised audit history
