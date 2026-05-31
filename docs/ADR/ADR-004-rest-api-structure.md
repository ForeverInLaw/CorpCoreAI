# ADR-004: RESTful API Structure with Next.js Route Handlers

Status: Accepted  
Date: 2024-11-26  
Owner: Development Team  
Related Features: [Task Management](../Features/task-management.md), [Attachments](../Features/attachments.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The CorpCore AI Task Manager requires an API layer to:

- Serve the Telegram Mini App frontend
- Handle task CRUD operations
- Manage file attachments
- Support role-based data access
- Serialize BigInt values for JSON responses

---

## Decision

Implement RESTful API using Next.js App Router Route Handlers.

Key points:

- Route handlers in `app/api/` directory following REST conventions
- Resource-based URLs: `/api/tasks`, `/api/tasks/[taskId]`, `/api/attachments/[attachmentId]`
- Standard HTTP methods: GET, POST, PATCH, DELETE
- JSON request/response bodies
- Authentication via `Authorization` header with Telegram initData
- Role-based response filtering (managers see all, employees see own)

---

## Alternatives considered

### tRPC

- Pros: Type-safe end-to-end, automatic client generation
- Cons: Additional complexity, less familiar pattern
- Rejected because: Standard REST is sufficient and more widely understood

### GraphQL

- Pros: Flexible queries, single endpoint
- Cons: Complexity overhead, learning curve
- Rejected because: Application's data requirements are well-served by REST

### Separate Express Backend

- Pros: Full control, framework-agnostic
- Cons: Separate deployment, code duplication
- Rejected because: Next.js Route Handlers provide same functionality with simpler architecture

---

## Consequences

### Positive

- Familiar REST patterns for API consumers
- Co-located with frontend code
- Automatic TypeScript support
- Built-in request/response handling
- Easy to add new endpoints following conventions

### Negative / risks

- Manual serialization needed for BigInt values
- Mitigation: Consistent `toString()` conversion in response formatting
- No automatic API documentation
- Mitigation: Manual documentation in `docs/API/`

---

## Impact

### Code

- Affected modules / services: `app/api/` directory structure
- New boundaries / responsibilities: Each route handler responsible for auth, validation, response
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: N/A
- Config changes: N/A
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: All feature documentation
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: `docs/API/` documentation
- Notes for `AGENTS.md`: API routes follow REST conventions

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- API endpoints respond with correct status codes
- Authentication is enforced on all endpoints
- Role-based filtering works correctly

### Test environment

- Environment: Local development or Docker
- Data and reset strategy: Database seeding
- External dependencies: PostgreSQL database

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID | Scenario | Level (Unit / Int / API / UI) | Expected result | Notes / Data |
| --- | --- | --- | --- | --- |
| TST-001 | GET /api/tasks | API | Returns task list | Authenticated user |
| TST-002 | POST /api/tasks | API | Creates new task | Manager role |
| TST-003 | PATCH /api/tasks/[id] | API | Updates task | Valid task ID |
| TST-004 | Unauthorized access | API | 401/403 response | Missing/invalid auth |

### Regression and analysis

- Regression suites to run: API endpoint tests
- Static analysis: TypeScript compilation
- Monitoring during rollout: API error rates, response times

---

## Rollout and migration

- Migration steps: Deploy with Next.js application
- Backwards compatibility: N/A (new project)
- Rollback: Redeploy previous version

---

## References

- Issues / tickets: N/A
- External docs / specs: [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- Related ADRs: [ADR-002: Next.js Framework](ADR-002-nextjs-framework.md), [ADR-003: Authentication](ADR-003-telegram-webapp-authentication.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-004-rest-api-structure.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in