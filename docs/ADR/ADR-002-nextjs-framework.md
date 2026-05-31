# ADR-002: Next.js as Web Application Framework

Status: Accepted  
Date: 2024-11-26  
Owner: Development Team  
Related Features: [Task Management](../Features/task-management.md), [Authentication](../Features/authentication.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The CorpCore AI Task Manager needs a modern web framework to deliver:

- A responsive web interface for task management
- RESTful API endpoints for the Telegram Mini App
- Server-side rendering capabilities for performance
- TypeScript support for type safety
- Integration with the React ecosystem for UI components

The application is primarily accessed through Telegram Mini App but requires a full-featured web backend.

---

## Decision

Use Next.js 16 with App Router as the primary web application framework.

Key points:

- Next.js 16 with App Router for modern React patterns
- React 19 for UI components
- TypeScript for type safety
- Tailwind CSS 4 for styling
- Radix UI primitives for accessible components

---

## Alternatives considered

### Express.js + React SPA

- Pros: Simple architecture, mature ecosystem, full control
- Cons: Requires separate build configurations, no SSR out of box
- Rejected because: More complex setup for API + frontend integration

### Remix

- Pros: Modern framework, good data loading patterns
- Cons: Smaller ecosystem, less community adoption
- Rejected because: Next.js has broader ecosystem and better Vercel/Docker deployment support

### Fastify + Vue

- Pros: Fast backend, different frontend framework
- Cons: Team familiarity with React, ecosystem differences
- Rejected because: Team expertise is in React/Next.js ecosystem

---

## Consequences

### Positive

- Unified codebase for API and frontend
- Built-in routing with App Router
- Excellent TypeScript integration
- Large ecosystem of compatible packages
- Easy Docker deployment with official support
- Native support for API routes alongside pages

### Negative / risks

- Learning curve for App Router patterns
- Mitigation: Following official Next.js documentation and patterns
- Bundle size can grow with dependencies
- Mitigation: Careful dependency management, code splitting

---

## Impact

### Code

- Affected modules / services: All `app/` directory, components, API routes
- New boundaries / responsibilities: App Router conventions for routing and layouts
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: N/A
- Config changes: `next.config.ts` for Next.js configuration
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: All feature documentation
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: Use `pnpm dev` for development, `pnpm build` for production

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Application builds successfully
- API routes respond correctly
- Pages render without errors

### Test environment

- Environment: Local development with `pnpm dev`
- Data and reset strategy: N/A
- External dependencies: Node.js runtime

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID      | Scenario           | Level (Unit / Int / API / UI) | Expected result   | Notes / Data     |
| ------- | ------------------ | ----------------------------- | ----------------- | ---------------- |
| TST-001 | Build succeeds     | Integration                   | No build errors   | Production build |
| TST-002 | API routes respond | API                           | 200/401 responses | All endpoints    |

### Regression and analysis

- Regression suites to run: Lint checks, TypeScript compilation
- Static analysis: ESLint, TypeScript strict mode
- Monitoring during rollout: Application logs, error tracking

---

## Rollout and migration

- Migration steps: Docker build and deploy
- Backwards compatibility: N/A (new project)
- Rollback: Redeploy previous container image

---

## References

- Issues / tickets: N/A
- External docs / specs: [Next.js Documentation](https://nextjs.org/docs), [React Documentation](https://react.dev)
- Related ADRs: N/A

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-002-nextjs-framework.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in
