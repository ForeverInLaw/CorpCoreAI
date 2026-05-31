# ADR-009: Task History Audit Trail as an Append-Only Table

Status: Accepted  
Date: 2025-12-12  
Owner: Development Team  
Related Features: [Task History](../Features/task-history.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

Task state changes (status, deadline, assignee, team, tags/projects, review status) must be traceable to support:

- Accountability (who changed what and when)
- Debugging (why a task ended in a given state)
- Manager visibility and coordination

Relying only on the current `Task` row loses historical information and makes incident analysis difficult.

---

## Decision

Persist an append-only audit trail in a dedicated `TaskHistory` table, with typed event categories and JSON `details` payloads.

Key points:

- Each significant task change creates a new row in `TaskHistory`.
- `actorId` is optional (system actions like scheduler-driven overdue changes may be null).
- `details` is JSON to support heterogeneous payload shapes per event type.
- Reads return the most recent entries first and include actor display name.

---

## Alternatives considered

### Only updatedAt + current snapshot

- Pros: Minimal storage and implementation
- Cons: No “what changed” details, no actor attribution for each change
- Rejected because: The product requires an explicit change log.

### Event sourcing (full)

- Pros: Complete reconstruction, strong auditability
- Cons: Significant architecture shift and complexity
- Rejected because: Current scope needs an audit trail, not a full event-sourced model.

### Soft-delete and history tables per field

- Pros: Strong relational structure
- Cons: Many tables/columns, rigid schema for each change type
- Rejected because: JSON details provide sufficient flexibility with fewer moving parts.

---

## Consequences

### Positive

- Clear audit trail for key changes.
- Supports UI “history” views and operational debugging.
- Flexible payloads via JSON `details`.

### Negative / risks

- Additional writes and storage growth over time.
- Must ensure handlers don’t forget to log changes.
- JSON details require discipline to keep formats consistent.

---

## Impact

### Code

- Affected modules / services: `lib/task-history.ts`, API routes and bot actions that mutate tasks
- New boundaries / responsibilities: Mutations should log history entries near the write path
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: `TaskHistory` model in `prisma/schema.prisma`
- Config changes: N/A
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: [Task History](../Features/task-history.md)
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: N/A

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Mutating a task creates an appropriate history row.
- History is retrievable and includes actor name when available.

### Test environment

- Environment: Local dev with PostgreSQL
- Data and reset strategy: Create a task and perform changes (status, deadline)
- External dependencies: None

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID          | Scenario                      | Level (Unit / Int / API / UI) | Expected result           | Notes / Data       |
| ----------- | ----------------------------- | ----------------------------- | ------------------------- | ------------------ |
| TST-009-001 | Status change logs history    | API                           | TaskHistory entry created | type=STATUS_CHANGE |
| TST-009-002 | System action logs null actor | Integration                   | actorId null allowed      | reminders overdue  |

---

## Rollout and migration

- Migration steps: Apply Prisma migrations including TaskHistory
- Backwards compatibility: N/A
- Rollback: N/A (append-only logs)

---

## References

- Code: `lib/task-history.ts`
- Schema: `prisma/schema.prisma` (TaskHistory)
- Related ADRs: [ADR-001: PostgreSQL Database](ADR-001-postgresql-database.md), [ADR-004: REST API](ADR-004-rest-api-structure.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-009-task-history-audit-trail.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in
