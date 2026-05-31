# Testing Strategy

This document outlines the testing approach for the CorpCore AI project.

## Current Test Status

> **Note:** The project currently does not have a formal test suite implemented. This document serves as a roadmap for establishing comprehensive testing.

## Recommended Test Structure

```
tests/
├── unit/                    # Unit tests
│   ├── lib/                # Library function tests
│   │   ├── ai.test.ts
│   │   ├── auth.test.ts
│   │   ├── attachments.test.ts
│   │   └── task-history.test.ts
│   └── components/         # Component tests
│       ├── TaskCard.test.tsx
│       └── TaskHistoryLog.test.tsx
├── integration/            # Integration tests
│   ├── api/               # API route tests
│   │   ├── tasks.test.ts
│   │   └── attachments.test.ts
│   └── bot/               # Bot flow tests
│       └── commands.test.ts
├── e2e/                    # End-to-end tests
│   ├── task-lifecycle.test.ts
│   └── user-flows.test.ts
└── fixtures/               # Test data and mocks
    ├── tasks.ts
    └── users.ts
```

## Test Categories

### Unit Tests

**Purpose:** Test individual functions and components in isolation.

**Scope:**
- Library utilities (`lib/*.ts`)
- React components (`components/*.tsx`)
- Pure functions and helpers

**Recommended Tools:**
- [Vitest](https://vitest.dev/) — Fast unit test runner compatible with Vite
- [Testing Library](https://testing-library.com/) — React component testing
- [MSW](https://mswjs.io/) — API mocking

**Example Test Cases:**

| Module | Test Case |
|--------|-----------|
| `lib/auth.ts` | Validates Telegram init data correctly |
| `lib/auth.ts` | Rejects expired or tampered init data |
| `lib/ai.ts` | Parses AI-generated task structure |
| `lib/attachments.ts` | Generates correct download URLs |
| `lib/task-history.ts` | Creates proper history entries |
| `TaskCard.tsx` | Renders task with correct status badge |
| `TaskCard.tsx` | Displays deadline in user timezone |

### Integration Tests

**Purpose:** Test interactions between components and external services.

**Scope:**
- API routes (`app/api/**/*.ts`)
- Database operations via Prisma
- Telegram bot command handlers

**Recommended Tools:**
- [Vitest](https://vitest.dev/) with database fixtures
- [Supertest](https://github.com/ladjs/supertest) — HTTP assertion library
- Test database (PostgreSQL in Docker)

**Example Test Cases:**

| API Endpoint | Test Case |
|--------------|-----------|
| `GET /api/tasks` | Returns tasks for authenticated user |
| `POST /api/tasks` | Creates task with valid data |
| `PATCH /api/tasks/[id]` | Updates task status |
| `POST /api/tasks/[id]/attachments` | Uploads file attachment |
| `GET /api/attachments/download/[token]` | Downloads file with valid token |

**Bot Command Tests:**

| Command | Test Case |
|---------|-----------|
| `/start` | Registers new user correctly |
| `/tasks` | Lists user's tasks |
| Natural language | Parses deadline from Russian text |
| File upload | Attaches file to active task |

### End-to-End Tests

**Purpose:** Test complete user workflows through the entire system.

**Scope:**
- Full task lifecycle (create → assign → complete → review)
- User authentication flow
- File attachment workflow
- Reminder notifications

**Recommended Tools:**
- [Playwright](https://playwright.dev/) — Browser automation
- Docker Compose for test environment
- Mock Telegram API server

**Example Scenarios:**

1. **Task Creation Flow**
   - User sends natural language task description via bot
   - AI generates title and subtasks
   - Task appears in WebApp with correct data

2. **Task Completion Flow**
   - Assignee marks task as done
   - Manager receives notification
   - Manager approves completion
   - Task status changes to CLOSED

3. **Overdue Handling**
   - Task deadline passes
   - Reminder job marks task as OVERDUE
   - Manager receives escalation notification

## Running Tests

### Setup Test Environment

```bash
# Install test dependencies (when added)
pnpm install

# Start test database
docker-compose -f docker-compose.test.yml up -d db

# Run migrations on test database
DATABASE_URL="postgresql://..." pnpm prisma migrate deploy
```

### Test Commands (To Be Implemented)

```bash
# Run all tests (planned)
# pnpm test

# Run unit tests only (planned)
# pnpm test:unit

# Run integration tests (planned)
# pnpm test:integration

# Run e2e tests (planned)
# pnpm test:e2e

# Run tests with coverage (planned)
# pnpm test:coverage

# Run tests in watch mode (planned)
# pnpm test:watch
```

## Test Configuration

### Vitest Configuration (Recommended)

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', 'tests']
    }
  }
})
```

### Test Database Setup

```yaml
# docker-compose.test.yml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: corpcoreai_test
    ports:
      - "5433:5432"
```

## Coverage Goals

| Category | Target Coverage |
|----------|-----------------|
| Unit Tests | 80%+ |
| Integration Tests | 70%+ |
| E2E Tests | Critical paths covered |

## Continuous Integration

### GitHub Actions Workflow (Recommended)

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: corpcoreai_test
        ports:
          - 5432:5432
    
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm prisma generate
      - run: pnpm prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/corpcoreai_test
      
      # - run: pnpm test:coverage  # planned, not yet implemented
```

## Implementation Roadmap

### Phase 1: Foundation
- [ ] Add Vitest and Testing Library dependencies
- [ ] Create test configuration files
- [ ] Set up test database Docker configuration
- [ ] Create test fixtures for common data

### Phase 2: Unit Tests
- [ ] Test `lib/auth.ts` — Telegram authentication
- [ ] Test `lib/ai.ts` — AI response parsing
- [ ] Test `lib/task-history.ts` — History entry creation
- [ ] Test React components with Testing Library

### Phase 3: Integration Tests
- [ ] Test API routes with Supertest
- [ ] Test database operations with test fixtures
- [ ] Test bot command handlers

### Phase 4: E2E Tests
- [ ] Set up Playwright
- [ ] Create WebApp user flow tests
- [ ] Create bot interaction tests (with mock Telegram API)

### Phase 5: CI/CD
- [ ] Configure GitHub Actions workflow
- [ ] Add coverage reporting
- [ ] Set up PR checks

## Best Practices

1. **Test Isolation** — Each test should be independent and not rely on other tests
2. **Database Reset** — Clear test database between test runs
3. **Mock External Services** — Mock Telegram API, NVIDIA API in tests
4. **Meaningful Assertions** — Test behavior, not implementation details
5. **Fast Feedback** — Keep unit tests fast (<100ms per test)
6. **Descriptive Names** — Use clear test names that describe expected behavior