## Overview

CorpCore AI combines Telegram bot flows with a Telegram WebApp (Next.js) UI. The bot accepts natural-language task descriptions, generates titling/subtasks via NVIDIA Minimax, stores tasks in Postgres (Prisma), and the WebApp renders them with role-specific access. A background reminder job notifies assignees/managers about upcoming or overdue deadlines.

## Getting Started

Install dependencies and spin up the dev server:

```bash
pnpm install
pnpm dev
```

The app is designed to run inside a Telegram WebApp context, but the UI can be previewed at [http://localhost:3000](http://localhost:3000).

Environment variables required (see `.env.example` if available):

- `DATABASE_URL`
- `BOT_TOKEN`
- `NVIDIA_API_KEY`
- `WHITELIST`, `MANAGER_IDS`

## Reminder Scheduler (hourly)

Automated notifications are handled by `scripts/reminders.ts`. The script scans tasks hourly and sends daily nudges, "−1 day" warnings, day‑of‑deadline reminders, and overdue alerts (including manager escalation).

Run it manually:

```bash
pnpm reminders
```

### Cron / background job

Configure an hourly cron (UTC) on your host or container orchestrator:

```
0 * * * * cd /app && pnpm reminders >> /var/log/corpcore-reminders.log 2>&1
```

Ensure the job runs in an environment where `BOT_TOKEN` and `DATABASE_URL` are available; otherwise Prisma or Telegram calls will fail.

## Deployment notes

- Next.js app: deploy as usual (Vercel, Docker, etc.).
- Telegram bot: start via `pnpm tsx scripts/bot.ts` or your preferred process manager.
- Reminder job: keep the hourly job active alongside the bot to guarantee deadline control.
- Local `pnpm bot` and `pnpm reminders` require a `.env` file with `BOT_TOKEN`, `DATABASE_URL`, etc. (Docker injects these via compose, but local runs need the file).

Refer to Next.js documentation for advanced optimizations, ISR/SSR configuration, etc.
