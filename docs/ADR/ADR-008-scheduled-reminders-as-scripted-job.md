# ADR-008: Scheduled Reminders as a Scripted Job (tsx) with DB Idempotency Flags

Status: Accepted  
Date: 2025-12-12  
Owner: Development Team  
Related Features: [Notifications & Reminders](../Features/notifications-reminders.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The system must send time-based reminders to task assignees (and escalations to managers):

- Daily reminders for IN_PROGRESS tasks
- Deadline -1 day reminder
- Deadline day reminder
- Overdue notification and overdue escalation

A scheduler is required, but introducing a full queue system or managed scheduler increases complexity.

The reminders must also avoid duplicate sends when the job runs more than once per day.

---

## Decision

Implement reminders as an executable TypeScript script (`scripts/reminders.ts`) run via `tsx`, using per-task timestamp fields in the database as idempotency guards.

Key points:

- Script entry point: `pnpm reminders` (runs `tsx scripts/reminders.ts`).
- Job queries active tasks and performs reminder logic.
- Idempotency fields live on `Task` (e.g., `lastDailyReminderAt`, `deadlineDayNotifiedAt`, `overdueNotifiedAt`).
- Overdue detection updates task status to `OVERDUE` and records `statusChangedAt`.
- Docker Compose runs a dedicated `reminders` service that sleeps and executes on a fixed daily schedule (08:00 MSK / 05:00 UTC).

---

## Alternatives considered

### External cron only

- Pros: Very simple, no long-running container
- Cons: Host-specific configuration, harder to ship as a single compose bundle
- Rejected because: Compose-based deployments benefit from having a dedicated reminders service.

### Background queue (BullMQ / Redis)

- Pros: Robust scheduling/retries, distributed workers
- Cons: Additional infra (Redis), operational overhead
- Rejected because: Current scale and requirements don’t justify introducing Redis/queue.

### Managed scheduler (cloud)

- Pros: Reliable, minimal maintenance
- Cons: Cloud coupling, additional credentials and deployment complexity
- Rejected because: Project supports Docker-first deployments.

---

## Consequences

### Positive

- Minimal infrastructure: no extra services beyond the existing stack.
- Clear, testable logic in a standalone script.
- DB flags prevent duplicate notifications.

### Negative / risks

- Requires exactly one active scheduler instance (avoid duplicate sends across multiple deployments).
- Schedule correctness depends on container time and the chosen time zone mapping.
- Failures are logged; no automatic retry strategy beyond the next run.

---

## Impact

### Code

- Affected modules / services: `scripts/reminders.ts`, `docker-compose.yml`, `prisma/schema.prisma` (reminder fields)
- New boundaries / responsibilities: Scheduler owns time-based state transitions (e.g., overdue)
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: Timestamp fields on `Task` used for idempotency
- Config changes: `BOT_TOKEN` and `DATABASE_URL` must be available to reminders job
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: [Notifications & Reminders](../Features/notifications-reminders.md)
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: Reminders run via `pnpm reminders`.

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Running the script sends the expected reminders for tasks in different deadline windows.
- Re-running the script the same day does not resend daily reminders.

### Test environment

- Environment: Local dev with database seeded
- Data and reset strategy: Create tasks with deadlines: tomorrow/today/yesterday
- External dependencies: Telegram API (`BOT_TOKEN`)

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- run reminders: `pnpm reminders`

### New or changed tests

| ID          | Scenario                         | Level (Unit / Int / API / UI) | Expected result                | Notes / Data     |
| ----------- | -------------------------------- | ----------------------------- | ------------------------------ | ---------------- |
| TST-008-001 | Daily reminder only once per day | Integration                   | Second run sends nothing       | Same day re-run  |
| TST-008-002 | Overdue task becomes OVERDUE     | Integration                   | Status updated + notifications | deadline in past |

---

## Rollout and migration

- Migration steps: Deploy reminders service/job alongside app and bot
- Backwards compatibility: N/A
- Rollback: Stop reminders service

---

## References

- Code: `scripts/reminders.ts`, `docker-compose.yml`
- Schema: `prisma/schema.prisma` (Task reminder fields)
- Related ADRs: [ADR-005: Telegram Bot](ADR-005-telegram-bot-integration.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-008-scheduled-reminders-as-scripted-job.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in
