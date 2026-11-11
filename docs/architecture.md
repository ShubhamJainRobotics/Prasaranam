# Prasaranam Architecture and System Design

Relay is a production-grade, evidence-grounded, permission-aware knowledge handover system. It assists outgoing engineers and team leads in generating high-integrity handovers for incoming members while ensuring cryptographic provenance, strict tenant isolation, and zero unauthorized leakage of restricted material.

```mermaid
flowchart TD
    subgraph Client ["Client Browser (apps/web)"]
        UI[React 18 + Tailwind SPA]
        AuthClient[Supabase JS Auth Only]
    end

    subgraph API ["Application Server (apps/api)"]
        Router[Express 4 Router & Middleware]
        Ingestion[Ingestion Engine & Normalizer]
        Security[Auth Guards & Rate Limiter]
        OpenAPI[OpenAPI 3.1 Contract]
    end

    subgraph Worker ["Background Worker (apps/worker)"]
        JobLease[Advisory Lock Job Engine]
        ExtractHandler[Access-Class Extractor]
        HandoverHandler[Handover Generation Engine]
        QAHandler[Grounded Q&A Service]
    end

    subgraph AI ["AI Provider Layer"]
        GeminiAdapter[Gemini 2.5 Flash Adapter]
        FakeAdapter[Deterministic Fake Provider]
    end

    subgraph Database ["Persistence Layer (PostgreSQL 17 / Supabase)"]
        PublicSchema[public: RLS Enabled Tables]
        AppPrivate[app_private: SECURITY DEFINER Functions]
        AuditEvents[Immutable Audit Log]
    end

    UI -->|JWT Auth Only| AuthClient
    UI -->|Data & Mutations REST API| Router
    Router --> Ingestion
    Router --> Security
    Security -->|Transaction & Row Locks| AppPrivate
    AppPrivate --> PublicSchema
    AppPrivate --> AuditEvents
    Worker --> JobLease
    JobLease --> AppPrivate
    Worker --> ExtractHandler
    Worker --> HandoverHandler
    Worker --> QAHandler
    ExtractHandler --> GeminiAdapter
    ExtractHandler --> FakeAdapter
    HandoverHandler --> GeminiAdapter
    QAHandler --> GeminiAdapter
```

---

## 1. Monorepo Organization

The project is structured as an npm workspaces monorepo:

| Directory                | Role              | Description                                                                                                                                          |
| ------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`               | Backend API       | Express HTTP service providing REST endpoints, authentication middleware, file ingestion, rate limiting, and mutation invocation.                    |
| `apps/web`               | Frontend SPA      | Vite + React application providing accessible UI components, source viewer, chunk highlighter, handover review studio, and Ask Relay Q&A.            |
| `apps/worker`            | Background Worker | Independent Node.js service leasing and executing asynchronous jobs (`extract`, `analyze_relationships`, `generate_handover`, `generate_questions`). |
| `packages/contracts`     | Shared Contracts  | Shared Zod schemas, TypeScript types, constants, and generated JSON Schema definitions.                                                              |
| `packages/database`      | Database Client   | Connection pooling, typed wrappers for `app_private` SQL functions, and transactional helpers.                                                       |
| `packages/test-fixtures` | Test Utilities    | Fixtures, test user factories, synthetic payment documents, and mocked test environments.                                                            |

---

## 2. Core Workflows & Sequence Diagrams

### 2.1 Ingestion Flow

Source text and structured files enter the system via `POST /api/v1/projects/:id/sources/import`.

```mermaid
sequenceDiagram
    autonumber
    actor User as Contributor / Reviewer
    participant API as apps/api (Ingestion)
    participant DB as PostgreSQL (app_private)

    User->>API: POST /projects/:id/sources/import (Multipart or Paste)
    Note over API: Strict UTF-8 decoding, BOM strip, C0 control validation
    Note over API: Compute canonical content & SHA-256 hash
    Note over API: Segment into non-overlapping chunks (<= 1500 cp)
    API->>DB: CALL app_private.import_source(actor_id, project_id, title, chunks, visibility, grants)
    Note over DB: Lock project row, bump access_epoch, insert source & chunks
    DB-->>API: source_id, chunk_count, access_epoch
    API-->>User: 201 Created (Source Summary)
```

### 2.2 Extraction & Access-Class Batching

Extraction jobs process sources strictly partitioned by access class `(visibility, set of granted user IDs)`.

```mermaid
sequenceDiagram
    autonumber
    participant Worker as apps/worker
    participant DB as PostgreSQL (app_private)
    participant AI as Gemini 2.5 Flash / Fake Provider

    Worker->>DB: CALL app_private.lease_job(worker_id)
    DB-->>Worker: job_data (kind: 'extract', access_class)
    Worker->>DB: Query unextracted chunks matching access_class
    DB-->>Worker: Chunks array
    Note over Worker: Construct ExtractionInput envelope with chunk IDs
    Worker->>AI: generateContent(ExtractionPrompt, Chunks)
    AI-->>Worker: Raw JSON output
    Note over Worker: Defensive parsing, Zod validation, Semantic validation
    Note over Worker: Verify quote substring match & code-point offsets
    Worker->>DB: CALL app_private.persist_claims(job_id, claims, access_epoch)
    Note over DB: Recheck project access_epoch; persist claims or STALE_CONTEXT
    DB-->>Worker: Success (persisted count)
```

### 2.3 Handover Generation, Review & Immutability

```mermaid
sequenceDiagram
    autonumber
    actor Reviewer as Departing Lead (Reviewer)
    actor Recipient as Incoming Lead (Recipient)
    participant Worker as apps/worker
    participant DB as PostgreSQL (app_private)

    Reviewer->>Worker: POST /projects/:id/handovers (recipient_id, sections)
    Note over Worker: Filter claims readable by BOTH Reviewer & Recipient
    Worker->>DB: CALL app_private.create_handover_draft_from_generation(...)
    DB-->>Reviewer: 202 Queued -> 200 Handover Draft (Status: draft)
    Note over Reviewer: Reviews each item, edits wording, verifies evidence
    Reviewer->>DB: CALL app_private.approve_handover(confirmReviewedForRecipient: true)
    Note over DB: Lock row, verify zero pending items, set status = 'approved'
    Reviewer->>DB: CALL app_private.share_handover(recipient_id)
    Note over DB: Set status = 'shared', mark older versions 'superseded'
    Recipient->>DB: GET /handovers/:id
    DB-->>Recipient: 200 OK (Immutable Shared Handover)
```

### 2.4 Evidence-Grounded Q&A (Ask Prasaranam)

```mermaid
sequenceDiagram
    autonumber
    actor Recipient as Incoming Lead (Recipient)
    participant API as apps/api (Q&A Router)
    participant DB as PostgreSQL (app_private)
    participant AI as Gemini 2.5 Flash Provider

    Recipient->>API: POST /conversations/:id/messages (question)
    API->>DB: Query top 40 matching claims readable by Recipient
    alt No matching claims found
        API-->>Recipient: 200 OK (Insufficient Evidence Statement - No AI call)
    else Matches found
        API->>AI: AnswerInput envelope (Question, Candidate Claims)
        AI-->>API: Answer output (Text, Cited Claim IDs)
        Note over API: Semantic validator verifies cited claims were supplied
        API->>DB: CALL app_private.record_message(conversation_id, answer, current_epoch)
        DB-->>API: Saved message
        API-->>Recipient: 200 OK (Grounded Answer with verified citations)
    end
```

---

## 3. Data Flow and Access Boundaries

1. **All Data Through API**: The web frontend communicates with Supabase strictly for session authentication (`auth.users`). Zero database table reads or writes occur from the browser directly.
2. **Access-Epoch Synchronization**: Any access change (member addition/removal, role change, source visibility change, or source archiving) atomically increments `public.projects.access_epoch`. Any generation, persistence, or Q&A operation citing a previous epoch is rejected with `STALE_CONTEXT`.
3. **Immutability Triggers**: Handover drafts that have been approved or shared cannot have their items, configuration, or citations altered. Subsequent edits require creating a new revision (`POST /handovers/:id/versions`).
