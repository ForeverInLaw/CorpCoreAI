# ADR-005: Telegram Bot with grammY Framework

Status: Accepted  
Date: 2024-11-26  
Owner: Development Team  
Related Features: [Telegram Bot](../Features/telegram-bot.md), [AI Task Parsing](../Features/ai-task-parsing.md), [Notifications & Reminders](../Features/notifications-reminders.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The CorpCore AI Task Manager requires a Telegram bot to:

- Accept natural language task descriptions from users
- Parse tasks using AI and create them in the system
- Allow inline task management (status changes, deadline updates)
- Handle file attachments from Telegram
- Send notifications and reminders to users
- Support manager workflows (assignee selection)

---

## Decision

Implement the Telegram bot using the grammY framework running as a separate long-polling process.

Key points:

- grammY 1.38+ as the bot framework
- Long-polling mode (not webhooks) for simpler deployment
- Separate Docker service for bot process
- In-memory state for pending operations (task drafts, deadline requests)
- Inline keyboards for interactive task management
- Custom context with user data injection via middleware

---

## Alternatives considered

### Telegraf

- Pros: Popular, mature, large community
- Cons: TypeScript support less refined, larger API surface
- Rejected because: grammY offers better TypeScript integration and modern API design

### node-telegram-bot-api

- Pros: Simple, minimal, no dependencies
- Cons: Basic features, more manual work required
- Rejected because: grammY provides better abstractions for complex interactions

### Webhook Mode

- Pros: Efficient for high-traffic bots, no persistent connection
- Cons: Requires HTTPS endpoint, more complex setup
- Rejected because: Long-polling is simpler for internal corporate bot with moderate traffic

---

## Consequences

### Positive

- Excellent TypeScript support with full type inference
- Clean API for handling messages, callbacks, and media
- Built-in middleware system for authentication and context enrichment
- Active development and good documentation
- Simple deployment as standalone process

### Negative / risks

- In-memory state lost on bot restart
- Mitigation: State is temporary (pending drafts); users can restart flow
- Long-polling keeps connection open
- Mitigation: Acceptable for dedicated bot service container
- Separate process requires coordination with main app
- Mitigation: Shared database provides coordination point

---

## Impact

### Code

- Affected modules / services: `lib/bot/index.ts`, `scripts/bot.ts`
- New boundaries / responsibilities: Bot handles Telegram interactions, delegates to shared lib functions
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: N/A (uses shared Prisma models)
- Config changes: `BOT_TOKEN`, `WHITELIST` environment variables
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: [Telegram Bot](../Features/telegram-bot.md)
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: Run bot with `pnpm bot`

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Bot responds to /start command
- Task creation flow works end-to-end
- Inline keyboards function correctly
- Whitelist enforcement works

### Test environment

- Environment: Docker Compose with bot service
- Data and reset strategy: Database reset for clean state
- External dependencies: Telegram Bot API

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID      | Scenario               | Level (Unit / Int / API / UI) | Expected result         | Notes / Data        |
| ------- | ---------------------- | ----------------------------- | ----------------------- | ------------------- |
| TST-001 | /start command         | Integration                   | Welcome message sent    | Bot running         |
| TST-002 | Task text parsing      | Integration                   | AI parses, task created | Valid text input    |
| TST-003 | Whitelist check        | Integration                   | Non-whitelisted denied  | User not in list    |
| TST-004 | Status change callback | Integration                   | Task status updated     | Valid callback data |

### Regression and analysis

- Regression suites to run: Bot interaction tests
- Static analysis: TypeScript compilation
- Monitoring during rollout: Bot error logs, Telegram API errors

---

## Rollout and migration

- Migration steps: Deploy bot container with `pnpm bot` command
- Backwards compatibility: N/A (new project)
- Rollback: Stop bot container, redeploy previous version

---

## References

- Issues / tickets: N/A
- External docs / specs: [grammY Documentation](https://grammy.dev/), [Telegram Bot API](https://core.telegram.org/bots/api)
- Related ADRs: [ADR-003: Authentication](ADR-003-telegram-webapp-authentication.md), [ADR-006: AI Integration](ADR-006-nvidia-ai-integration.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-005-telegram-bot-integration.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in
