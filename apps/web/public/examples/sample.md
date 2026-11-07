# Payments Service Architecture Decision

## Context

The payments service requires strict idempotency, auditability, and multi-tenant data isolation.

## Decision

We adopted PostgreSQL with Row Level Security (RLS) as our single source of truth for financial transactions.

## Operational Constraints

- All mutations must be executed within transactional procedures.
- Daily reconciliation jobs run at 02:00 UTC.
