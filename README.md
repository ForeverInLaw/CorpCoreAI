## Overview

CorpCore AI combines Telegram bot flows with a Telegram WebApp (Next.js) UI. The bot accepts natural-language task descriptions, generates titling/subtasks via NVIDIA Minimax, stores tasks in Postgres (Prisma), and the WebApp renders them with role-specific access. A background reminder job notifies assignees/managers about upcoming or overdue deadlines.

## Getting Started

Install dependencies and spin up the dev server:

```bash
pnpm install
pnpm dev
```

The app is designed to run inside a Telegram WebApp context, but the UI can be previewed at [http://localhost:3000](http://localhost:3000).

### Environment Variables

Required (see `.env.example`):

| Variable            | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL connection string                                        |
| `POSTGRES_PASSWORD` | Used by `docker-compose.yml` to set the Postgres container password |
| `BOT_TOKEN`         | Telegram bot token from @BotFather                                  |
| `NVIDIA_API_KEY`    | NVIDIA Minimax API key                                              |
| `WHITELIST`         | Comma-separated Telegram user IDs allowed to access the app         |
| `MANAGER_IDS`       | Comma-separated Telegram user IDs with manager role                 |

### Scripts

| Command             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Start Next.js dev server                               |
| `pnpm build`        | Build production bundle                                |
| `pnpm start`        | Run migrations + start production server               |
| `pnpm lint`         | Run ESLint                                             |
| `pnpm format`       | Format all files with Prettier                         |
| `pnpm format:check` | Check formatting without writing (CI)                  |
| `pnpm bot`          | Run migrations + start Telegram bot                    |
| `pnpm reminders`    | Run migrations + run reminder job (daily at 08:00 MSK) |

## State Management

The app uses **Zustand** for client state, split into 4 granular stores:

| Store             | File                | Purpose                                                      |
| ----------------- | ------------------- | ------------------------------------------------------------ |
| `useAuthStore`    | `stores/auth.ts`    | Auth state: `isAuthorized`, `currentUser`, `accessDenied`    |
| `useTasksStore`   | `stores/tasks.ts`   | Task list, pagination cursor, loading states, employees      |
| `useFiltersStore` | `stores/filters.ts` | Active tab, assignee filter, search query                    |
| `useUiStore`      | `stores/ui.ts`      | Upload/download states, deadline drafts, team drafts, errors |

All stores use selectors to prevent unnecessary re-renders. Derived state (filtered tasks, tab counts) is computed via `useMemo` in `app/page.tsx`, not stored in Zustand.

## Rate Limiting

API rate limiting is implemented in `proxy.ts` (Next.js 16 middleware pattern) using an in-memory sliding window (`lib/rate-limit.ts`). Limits are per-user, keyed on the signed `Authorization` header from Telegram WebApp.

## Reminder Scheduler

Automated notifications are handled by `scripts/reminders.ts`. The script:

1. Runs once at container/process start
2. Sleeps until 08:00 MSK (05:00 UTC) each day
3. Sends daily nudges, "−1 day" warnings, day-of-deadline reminders, and overdue alerts (including manager escalation)
4. Cleans up `TaskHistory` entries older than 90 days

Run manually:

```bash
pnpm reminders
```

## Docker

```bash
docker compose up --build
```

Services:

| Service     | Description                             |
| ----------- | --------------------------------------- |
| `app`       | Next.js production server (port 3005)   |
| `bot`       | Telegram bot                            |
| `reminders` | Daily reminder + history cleanup job    |
| `migrate`   | Runs `prisma migrate deploy` then exits |
| `db`        | PostgreSQL 18                           |

All services wait for `migrate` to complete before starting. The `db` service has a healthcheck (`pg_isready`).

## Deployment

- **Docker:** `docker compose up --build` — all services managed by compose
- **Local:** `pnpm bot` and `pnpm reminders` require a `.env` file (Docker injects via compose)
- **Vercel/other:** Deploy the Next.js app; run bot and reminders separately

Refer to Next.js documentation for advanced optimizations, ISR/SSR configuration, etc.
