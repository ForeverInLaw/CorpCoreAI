# ADR-001: PostgreSQL as Primary Database

Status: Accepted  
Date: 2024-11-26  
Owner: Development Team  
Related Features: [Task Management](../Features/task-management.md), [Task History](../Features/task-history.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The CorpCore AI Task Manager requires a robust, reliable database solution to store tasks, user information, attachments metadata, task history, and related entities. The system needs to support:

- Complex relational data with multiple relationships (users, tasks, assignments, tags, projects)
- ACID transactions for data integrity
- Concurrent access from multiple services (web app, bot, reminders)
- JSON storage for flexible fields (subtasks, history details)
- Strong typing and schema enforcement

---

## Decision

Use PostgreSQL as the primary database, accessed through Prisma ORM.

Key points:

- PostgreSQL 18 (Alpine) deployed via Docker Compose
- Prisma Client with PostgreSQL adapter for type-safe database access
- Schema-based migrations managed through Prisma Migrate

---

## Alternatives considered

### MySQL

- Pros: Widely used, good performance, mature ecosystem
- Cons: Weaker JSON support, less advanced features
- Rejected because: PostgreSQL offers better JSON handling and more advanced features needed for the application

### MongoDB

- Pros: Flexible schema, native JSON documents, horizontal scaling
- Cons: No ACID transactions across documents, weaker relational support
- Rejected because: The application has strong relational requirements (tasks, users, assignments, tags) that benefit from a relational database

### SQLite

- Pros: Simple, no separate server, good for small apps
- Cons: Limited concurrent access, not suitable for multi-service architecture
- Rejected because: Multiple services (app, bot, reminders) need concurrent database access

---

## Consequences

### Positive

- Strong data integrity with ACID transactions
- Excellent JSON support via `Json` type in Prisma for flexible fields
- Mature ecosystem with excellent tooling
- Good performance for relational queries with proper indexing
- Type-safe database access through Prisma

### Negative / risks

- Requires dedicated server/container for database
- Mitigation: Docker Compose simplifies deployment and management
- Needs proper backup and maintenance procedures
- Mitigation: Volume persistence configured in docker-compose.yml

---

## Impact

### Code

- Affected modules / services: `lib/db.ts`, all API routes, bot service, reminders service
- New boundaries / responsibilities: Prisma Client handles all database operations
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: Defined in `prisma/schema.prisma`
- Config changes: `DATABASE_URL` environment variable required
- Backwards compatibility: Migrations track all schema changes

### Documentation

- Feature docs to update: All feature documentation referencing data storage
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: Database migrations via `pnpm prisma migrate dev`

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Database correctly stores and retrieves all entity types
- Transactions maintain data integrity
- JSON fields work correctly for subtasks and history details

### Test environment

- Environment: Docker Compose local development
- Data and reset strategy: `prisma migrate reset` for clean state
- External dependencies: PostgreSQL container

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID      | Scenario             | Level (Unit / Int / API / UI) | Expected result                      | Notes / Data         |
| ------- | -------------------- | ----------------------------- | ------------------------------------ | -------------------- |
| TST-001 | Task CRUD operations | Integration                   | Tasks persist and retrieve correctly | Seed data            |
| TST-002 | Concurrent access    | Integration                   | No data corruption                   | Multiple connections |

### Regression and analysis

- Regression suites to run: API endpoint tests
- Static analysis: TypeScript compilation, ESLint
- Monitoring during rollout: Database connection logs, query performance

---

## Rollout and migration

- Migration steps: `pnpm prisma migrate deploy` in production
- Backwards compatibility: Prisma migrations are sequential and versioned
- Rollback: Revert to previous migration if needed

---

## References

- Issues / tickets: N/A
- External docs / specs: [Prisma Documentation](https://www.prisma.io/docs), [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- Related ADRs: N/A

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-001-postgresql-database.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in
