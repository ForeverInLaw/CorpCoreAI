# ADR-010: Docker Compose Multi-Service Topology (app + bot + reminders + migrate + db)

Status: Accepted  
Date: 2025-12-12  
Owner: Development Team  
Related Features: [Telegram Bot](../Features/telegram-bot.md), [Notifications & Reminders](../Features/notifications-reminders.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The system consists of multiple runtime concerns:

- Web application (Next.js UI + API)
- Telegram bot long-polling worker
- Scheduled reminders job
- Database migrations
- PostgreSQL database

These components must be deployed together consistently, and application processes should not start before migrations are applied.

---

## Decision

Use Docker Compose to run separate services for `app`, `bot`, `reminders`, `migrate`, and `db`, coordinating startup via `depends_on` with a dedicated migration service.

Key points:

- `db` is a Postgres container with a persistent volume.
- `migrate` runs `pnpm prisma migrate deploy` once and exits.
- `app`, `bot`, and `reminders` depend on `migrate` completion.
- All services share the same Prisma schema and database.

---

## Alternatives considered

### Single container running multiple processes

- Pros: Fewer containers
- Cons: Harder supervision, logs separation, restarts, and scaling
- Rejected because: Clear separation of concerns is simpler to operate and reason about.

### Running migrations manually

- Pros: Simple compose file
- Cons: Risk of forgetting migrations; race conditions during deploy
- Rejected because: Deploys should be automated and repeatable.

### Kubernetes

- Pros: Strong orchestration and scalability
- Cons: Operational overhead, outside current scope
- Rejected because: Compose is sufficient for the target deployment model.

---

## Consequences

### Positive

- Clear operational boundaries (web vs bot vs scheduler).
- Repeatable deployments with built-in migration step.
- Easier to restart/scale individual components.

### Negative / risks

- Multiple containers to manage.
- Compose `depends_on` does not guarantee full application readiness (only container/migrate completion).
- Reminders scheduling inside container must be kept single-instance to avoid duplicates.

---

## Impact

### Code

- Affected modules / services: `docker-compose.yml`, `Dockerfile`, Prisma migrations
- New boundaries / responsibilities: Migration step is part of deployment pipeline
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: N/A
- Config changes: `.env` used by all services; `DATABASE_URL` rewritten for in-network `db` host
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: [Telegram Bot](../Features/telegram-bot.md), [Notifications & Reminders](../Features/notifications-reminders.md)
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: `docs/API/Development/setup.md`
- Notes for `AGENTS.md`: Do not expose internal ports in production compose.

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Compose brings up db, applies migrations, then starts app/bot/reminders.

### Test environment

- Environment: Local Docker
- Data and reset strategy: Fresh volume or `prisma migrate reset` in dev
- External dependencies: Telegram API / NVIDIA API for full functionality

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID          | Scenario              | Level (Unit / Int / API / UI) | Expected result       | Notes / Data      |
| ----------- | --------------------- | ----------------------------- | --------------------- | ----------------- |
| TST-010-001 | Compose startup order | Integration                   | app waits for migrate | docker-compose up |

---

## Rollout and migration

- Migration steps: `migrate` service runs `prisma migrate deploy` automatically
- Backwards compatibility: N/A
- Rollback: Redeploy previous images; database rollback depends on migration strategy

---

## References

- Config: `docker-compose.yml`
- Related ADRs: [ADR-001: PostgreSQL Database](ADR-001-postgresql-database.md), [ADR-005: Telegram Bot](ADR-005-telegram-bot-integration.md), [ADR-008: Reminders Job](ADR-008-scheduled-reminders-as-scripted-job.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-010-docker-compose-multi-service-topology.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in
