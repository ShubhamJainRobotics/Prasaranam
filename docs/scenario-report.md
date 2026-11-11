# Synthetic Scenario Pack & Feature Health Report

**Generated At**: `2026-11-10T19:08:33.658Z`  
**Environment**: Local Supabase (`127.0.0.1`), Fake AI Provider

## 1. Executive Summary

| Metric              | Count  |
| :------------------ | :----- |
| **Total Scenarios** | 9      |
| **Total Steps**     | 97     |
| **Passed Steps**    | **90** |
| **Broken Steps**    | **6**  |
| **Not Built Steps** | **1**  |

## 2. Scenario Results Breakdown

|  #  | Scenario                                                | Passed | Broken | Not Built | Total |
| :-: | :------------------------------------------------------ | :----: | :----: | :-------: | :---: |
|  1  | **Onboarding and workspace**                            |   9    |   3    |     0     |  12   |
|  2  | **Importing sources**                                   |   15   |   1    |     0     |  16   |
|  3  | **Access control**                                      |   9    |   1    |     1     |  11   |
|  4  | **Knowledge extraction**                                |   13   |   0    |     0     |  13   |
|  5  | **Clarification and reviewer context**                  |   8    |   0    |     0     |   8   |
|  6  | **Handover lifecycle**                                  |   13   |   1    |     0     |  14   |
|  7  | **Evidence-grounded Q&A and export**                    |   9    |   0    |     0     |   9   |
|  8  | **Revocation, staleness, and access epoch advancement** |   9    |   0    |     0     |   9   |
|  9  | **Security hardening, hygiene, and audit integrity**    |   5    |   0    |     0     |   5   |

## 3. Broken Steps

### `scn1-step-09-last-owner-project`: Last owner protection at project level

- **Feature**: `Database Constraint / Trigger (last-owner-protection)`
- **Scenario**: Onboarding and workspace
- **Action**: Attempt to demote the sole active owner in project
- **Request**: `PATCH /api/v1/projects/6cef6a49-c200-40f1-86d0-1153c6fec727/members/f8973825-a5e0-4212-b54c-c65945318897`
- **Response Status**: `200`
- **Expected**: HTTP 409 LAST_OWNER
- **Actual**: `{"data":{"userId":"f8973825-a5e0-4212-b54c-c65945318897","active":false},"requestId":"f6eea635-f6ec-4035-b850-6acb7c710d5e"}`
- **Likely Source File**: [`supabase/migrations/20261107100002_mutation_functions.sql`](file:////home/shubham/Relay/supabase/migrations/20261107100002_mutation_functions.sql)

### `scn1-step-10-last-owner-org`: Last owner protection at organisation level

- **Feature**: `Database Constraint / Trigger (last-owner-protection)`
- **Scenario**: Onboarding and workspace
- **Action**: Attempt to demote the sole active organisation owner
- **Request**: `PATCH /api/v1/organisations/b350b5e6-fe94-43a8-bde7-46e8864aa23e/members/f8973825-a5e0-4212-b54c-c65945318897`
- **Response Status**: `403`
- **Expected**: HTTP 409 LAST_OWNER
- **Actual**: `{"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action.","details":[]},"requestId":"a0767360-1d2a-44f1-b978-bc679dc2bc5a"}`
- **Likely Source File**: [`supabase/migrations/20261107100002_mutation_functions.sql`](file:////home/shubham/Relay/supabase/migrations/20261107100002_mutation_functions.sql)

### `scn1-step-12-unknown-email-non-enumeration`: Non-enumerating member addition

- **Feature**: `POST /api/v1/projects/:id/members`
- **Scenario**: Onboarding and workspace
- **Action**: Invite an unknown email address and check for generic response
- **Request**: `POST /api/v1/projects/6cef6a49-c200-40f1-86d0-1153c6fec727/members`
- **Response Status**: `404`
- **Expected**: HTTP 200/201 generic response
- **Actual**: `{"error":{"code":"NOT_FOUND","message":"Resource not found.","details":[]},"requestId":"c5732b8c-7052-4bc5-818e-77b837d526f6"}`
- **Likely Source File**: [`apps/api/src/routes/projects.ts`](file:////home/shubham/Relay/apps/api/src/routes/projects.ts)

### `scn2-step-16-duplicate-import-detection`: Duplicate import detection & allowDuplicate override

- **Feature**: `Duplicate Import Detection (Hackathon Addition 3)`
- **Scenario**: Importing sources
- **Action**: Re-import identical content; observe 409 DUPLICATE_SOURCE; retry with allowDuplicate: true
- **Response Status**: `201`
- **Expected**: HTTP 409 DUPLICATE_SOURCE
- **Actual**: `{"data":{"sources":[{"id":"9126147c-1be0-46cf-b5e8-a7fe3d91a45a","projectId":"0bc6e813-4301-4e48-81cb-4fe540157499","title":"Duplicate Content Attempt","kind":"text","visibility":"project","originalUrl":null,"authorLabel":null,"eventAt":null,"contentSha256":"652189c8bb84c33fd87185f773118ae3aa34f65e8d3121e6af06a98d4267830e","revision":1,"lineageId":"5e7ad56e-a83a-48d0-b444-392b38f489a4","processingStatus":"ready","processingErrorCode":null,"archivedAt":null,"createdBy":"a7a09562-57c8-4369-9cd1-0a9a90237498","createdAt":"2026-11-10T19:08:17.699Z","chunkCount":1}],"source":{"id":"9126147c-1be0-46cf-b5e8-a7fe3d91a45a","projectId":"0bc6e813-4301-4e48-81cb-4fe540157499","title":"Duplicate Content Attempt","kind":"text","visibility":"project","originalUrl":null,"authorLabel":null,"eventAt":null,"contentSha256":"652189c8bb84c33fd87185f773118ae3aa34f65e8d3121e6af06a98d4267830e","revision":1,"lineageId":"5e7ad56e-a83a-48d0-b444-392b38f489a4","processingStatus":"ready","processingErrorCode":null,"archivedAt":null,"createdBy":"a7a09562-57c8-4369-9cd1-0a9a90237498","createdAt":"2026-11-10T19:08:17.699Z","chunkCount":1}},"requestId":"2ebddb74-ea6f-4894-9fc1-731e0ad64dc2"}`
- **Likely Source File**: [`apps/api/src/routes/sources.ts`](file:////home/shubham/Relay/apps/api/src/routes/sources.ts)

### `scn3-step-06-org-admin-project-isolation`: Organisation admin without project membership sees no project content

- **Feature**: `Tenant Isolation (SPEC Section 2A.2)`
- **Scenario**: Access control
- **Action**: OrgAdmin queries project summary, sources, and claims
- **Expected**: HTTP 404 NOT_FOUND for both queries
- **Actual**: `{"projectStatus":200,"sourcesStatus":404}`
- **Likely Source File**: [`apps/api/src/routes/projects.ts`](file:////home/shubham/Relay/apps/api/src/routes/projects.ts)

### `scn6-step-13-immutability-of-approved-and-shared`: Verify approved and shared versions are strictly immutable

- **Feature**: `Database Trigger Immutability (SPEC Section 2A.4 Item 8)`
- **Scenario**: Handover lifecycle
- **Action**: Attempt to update items or delete handover on approved/shared version
- **Response Status**: `500`
- **Expected**: HTTP 409/403/422 rejecting edit on shared version
- **Actual**: `{"error":{"code":"P0001","message":"An internal server error occurred.","details":[]},"requestId":"515bef62-3a85-45ac-b6f9-fd88bfa718b1"}`
- **Likely Source File**: [`apps/api/src/routes/handovers.ts`](file:////home/shubham/Relay/apps/api/src/routes/handovers.ts)

## 4. Not Built Yet Features

### API Routes Not Built:

- `GET /api/v1/projects/:id/audit`: Redacted audit history (SPEC Section 12)

### Web Routes Not Built:

- `/app/projects/:projectId/audit`: Authorised audit history (SPEC Section 6)

### Skipped Scenario Steps (Targeting Unbuilt Features):

- **`scn3-step-11-project-audit-trail`**: Read project audit trail (unbuilt feature) (Feature: `GET /api/v1/projects/:id/audit`) — _Feature not registered in application router_

## 5. Command Health Checks

### `npm run typecheck`

**Result**: PASSED (0 errors)

```

```

### `npm run lint`

**Result**: PASSED (0 errors)

```

```

### `npm run test`

**Result**: PASSED

```
1794337713266,"pid":118938,"hostname":"shubham-LOQ-15IAX9E","name":"fake-deterministic-provider","requestId":"test-req-3","model":"fake-deterministic","durationMs":1,"usage":{"inputTokens":279,"outputTokens":150},"adversarialMode":"none","msg":"Fake deterministic provider output generated"}
{"level":30,"time":1794337713266,"pid":118938,"hostname":"shubham-LOQ-15IAX9E","name":"fake-deterministic-provider","requestId":"test-req-4","model":"fake-deterministic","durationMs":0,"usage":{"inputTokens":273,"outputTokens":150},"adversarialMode":"fabricated_chunk_id","msg":"Fake deterministic provider output generated"}
 ✓ tests/unit/fake-provider.test.ts (5 tests) 12ms
 ✓ tests/unit/qa-validator.test.ts (12 tests) 113ms
 ✓ apps/api/test/ingestion.test.ts (17 tests) 81ms
 ✓ tests/unit/openapi.test.ts (1 test) 13ms

 Test Files  9 passed (9)
      Tests  87 passed (87)
   Start at  00:38:32
   Duration  799ms (transform 619ms, setup 0ms, collect 1.64s, tests 262ms, environment 2ms, prepare 732ms)
```
