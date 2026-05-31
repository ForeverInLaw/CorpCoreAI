# ADR-003: Telegram Web App Authentication

Status: Accepted  
Date: 2024-11-26  
Owner: Development Team  
Related Features: [Authentication](../Features/authentication.md), [Telegram Bot](../Features/telegram-bot.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The CorpCore AI Task Manager is designed as a Telegram Mini App, requiring authentication that:

- Integrates seamlessly with Telegram's identity system
- Provides secure user verification without separate credentials
- Supports role-based access (MANAGER vs EMPLOYEE)
- Works within Telegram's Mini App ecosystem
- Maintains a whitelist of authorized users

---

## Decision

Use Telegram Web App InitData for authentication with HMAC-SHA256 signature validation.

Key points:

- Validate Telegram `initData` using `@tma.js/init-data-node` library
- Extract user identity from validated initData
- Use Telegram user ID as primary user identifier
- Implement whitelist-based access control via environment variable
- 1-hour expiration on initData validation

---

## Alternatives considered

### JWT with Traditional Login

- Pros: Standard approach, widely understood, flexible
- Cons: Requires separate registration/login flow, not native to Telegram
- Rejected because: Adds friction for users; Telegram already provides identity

### OAuth with Telegram Login Widget

- Pros: Standard OAuth flow, works outside Telegram
- Cons: Requires redirect flow, not suitable for Mini App context
- Rejected because: Mini App provides better UX with built-in authentication

### Session-based Authentication

- Pros: Simple implementation, server-side control
- Cons: Requires session storage, state management complexity
- Rejected because: InitData validation is stateless and integrates naturally

---

## Consequences

### Positive

- Zero-friction authentication for Telegram users
- Cryptographically verified user identity
- No password management required
- User identity tied to Telegram account
- Simple whitelist management via environment variable

### Negative / risks

- Only works within Telegram Mini App context
- Mitigation: Application is designed specifically for Telegram integration
- Dependent on Telegram's security model
- Mitigation: Telegram's HMAC validation is industry-standard
- Whitelist requires manual management
- Mitigation: Can be extended to database-based management

---

## Impact

### Code

- Affected modules / services: `lib/auth.ts`, all API routes, `lib/users.ts`
- New boundaries / responsibilities: All API requests must include `Authorization` header with initData
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: User model uses `BigInt` for Telegram ID
- Config changes: `BOT_TOKEN` for validation, `WHITELIST` for access control
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: [Authentication](../Features/authentication.md)
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: All API calls require valid Telegram initData

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Valid initData is accepted and user extracted
- Invalid initData is rejected with 403
- Missing Authorization header returns 401
- Non-whitelisted users are denied access

### Test environment

- Environment: Telegram Mini App development mode
- Data and reset strategy: N/A
- External dependencies: Telegram Bot Token

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID | Scenario | Level (Unit / Int / API / UI) | Expected result | Notes / Data |
| --- | --- | --- | --- | --- |
| TST-001 | Valid initData | API | 200 response | Real Telegram session |
| TST-002 | Invalid initData | API | 403 Forbidden | Tampered data |
| TST-003 | Missing header | API | 401 Unauthorized | No Authorization |
| TST-004 | Non-whitelisted user | API | 403 Access denied | Valid but not in whitelist |

### Regression and analysis

- Regression suites to run: API authentication tests
- Static analysis: TypeScript type checking
- Monitoring during rollout: Authentication failure logs

---

## Rollout and migration

- Migration steps: Ensure BOT_TOKEN and WHITELIST are configured
- Backwards compatibility: N/A (new project)
- Rollback: N/A

---

## References

- Issues / tickets: N/A
- External docs / specs: [Telegram Mini Apps Documentation](https://core.telegram.org/bots/webapps), [@tma.js/init-data-node](https://www.npmjs.com/package/@tma.js/init-data-node)
- Related ADRs: [ADR-005: Telegram Bot Integration](ADR-005-telegram-bot-integration.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-003-telegram-webapp-authentication.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in