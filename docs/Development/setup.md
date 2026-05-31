# Development Setup Guide

This guide covers how to set up and run the CorpCore AI project locally.

## Overview

CorpCore AI is a task management system that combines:

- **Telegram Bot** — Accepts natural-language task descriptions and manages tasks via chat
- **Telegram WebApp** — Next.js-based UI for viewing and managing tasks
- **AI Integration** — NVIDIA Minimax for generating task titles and subtasks
- **Background Jobs** — Reminder scheduler for deadline notifications

## Prerequisites

### Required Tools

| Tool                    | Version | Purpose                             |
| ----------------------- | ------- | ----------------------------------- |
| Node.js                 | 20.x    | JavaScript runtime                  |
| pnpm                    | Latest  | Package manager                     |
| PostgreSQL              | 18.x    | Database                            |
| Docker & Docker Compose | Latest  | Containerized deployment (optional) |

### Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/corpcoreai?schema=public"
POSTGRES_PASSWORD="your-secure-password"

# Telegram Bot
BOT_TOKEN="your-telegram-bot-token"

# AI Integration
NVIDIA_API_KEY="your-nvidia-api-key"

# Access Control
WHITELIST="123456789,987654321"  # Comma-separated Telegram user IDs
MANAGER_IDS="123456789"          # Comma-separated manager Telegram IDs
```

## Installation

### Option 1: Local Development

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd CorpCoreAi
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Set up the database**

   Ensure PostgreSQL is running, then run migrations:

   ```bash
   pnpm prisma migrate deploy
   ```

4. **Generate Prisma client**

   ```bash
   pnpm prisma generate
   ```

5. **Start the development server**

   ```bash
   pnpm dev
   ```

   The app will be available at [http://localhost:3000](http://localhost:3000)

6. **Start the Telegram bot** (in a separate terminal)

   ```bash
   pnpm bot
   ```

7. **Run reminders manually** (optional)
   ```bash
   pnpm reminders
   ```

### Option 2: Docker Deployment

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd CorpCoreAi
   ```

2. **Create `.env` file** with required environment variables (see above)

3. **Start all services**

   ```bash
   docker-compose up -d
   ```

   This starts:
   - `app` — Next.js application (exposed on port 3005)
   - `bot` — Telegram bot service
   - `reminders` — Background reminder scheduler
   - `db` — PostgreSQL database
   - `migrate` — Database migration runner (runs once)

4. **View logs**

   ```bash
   docker-compose logs -f
   ```

5. **Stop services**
   ```bash
   docker-compose down
   ```

## Available Scripts

| Script         | Command             | Description                           |
| -------------- | ------------------- | ------------------------------------- |
| `dev`          | `pnpm dev`          | Start Next.js development server      |
| `build`        | `pnpm build`        | Build production bundle               |
| `start`        | `pnpm start`        | Start production server               |
| `lint`         | `pnpm lint`         | Run ESLint                            |
| `format`       | `pnpm format`       | Format all files with Prettier        |
| `format:check` | `pnpm format:check` | Check formatting without writing (CI) |
| `bot`          | `pnpm bot`          | Start Telegram bot                    |
| `reminders`    | `pnpm reminders`    | Run reminder job                      |

## Project Structure

```
CorpCoreAi/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── attachments/   # Attachment management
│   │   └── tasks/         # Task CRUD operations
│   ├── globals.css        # Tailwind + theme variables
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page (uses Zustand stores)
├── components/            # React components
│   ├── TaskCard.tsx       # Task card (React.memo wrapped)
│   ├── TaskHistoryLog.tsx # History timeline
│   └── ui/               # UI component library (shadcn/ui)
├── lib/                   # Shared utilities
│   ├── ai.ts             # NVIDIA Minimax integration
│   ├── auth.ts           # Telegram WebApp auth
│   ├── db.ts             # Prisma client
│   ├── download-tokens.ts # Attachment download tokens
│   ├── rate-limit.ts     # Sliding window rate limiter
│   ├── storage.ts        # File storage with path traversal guard
│   ├── task-history.ts   # TaskHistoryType enum re-export
│   ├── users.ts          # User whitelist + employee lookups
│   └── bot/              # Telegram bot logic
├── prisma/               # Database schema and migrations
│   ├── schema.prisma     # Prisma schema (TaskHistoryType enum)
│   └── migrations/       # Migration files
├── scripts/              # Background job scripts
│   ├── bot.ts           # Bot entry point
│   └── reminders.ts     # Reminder scheduler + history cleanup
├── stores/               # Zustand state stores
│   ├── auth.ts          # Auth state (isAuthorized, currentUser)
│   ├── tasks.ts         # Task list, pagination, employees
│   ├── filters.ts       # Active tab, assignee, search
│   └── ui.ts            # Upload/download, drafts, errors
├── storage/              # File uploads (gitignored)
├── types/                # TypeScript definitions
├── proxy.ts              # Next.js 16 middleware (rate limiting)
├── Dockerfile            # Multi-stage: runner + bot
└── docker-compose.yml    # 5 services: app, bot, reminders, migrate, db
```

## Code Style

- **Prettier** — Formats all code on save/commit. Config: `.prettierrc` (no semicolons, single quotes, trailing commas, Tailwind class sorting).
- **ESLint** — Lints TypeScript/Next.js. Config: `eslint.config.mjs`.
- Run `pnpm format` before committing. CI uses `pnpm format:check`.

## Database Schema

Key models:

- **User** — Telegram users with roles (EMPLOYEE, MANAGER)
- **Task** — Task records with status, deadline, subtasks
- **Project** — Project groupings for tasks
- **Tag** — Labels for task categorization
- **Attachment** — File attachments for tasks
- **TaskHistory** — Audit log of task changes

Run `pnpm prisma studio` to explore the database visually.

## Troubleshooting

### Common Issues

1. **Database connection errors**
   - Verify `DATABASE_URL` is correct
   - Ensure PostgreSQL is running
   - Check firewall/network settings

2. **Bot not responding**
   - Verify `BOT_TOKEN` is valid
   - Check if another bot instance is running
   - Review logs with `docker-compose logs bot`

3. **Build failures**
   - Clear `.next` folder: `rm -rf .next`
   - Reinstall dependencies: `rm -rf node_modules && pnpm install`
   - Regenerate Prisma client: `pnpm prisma generate`

### Getting Help

- Check existing documentation in `/docs`
- Review the README.md for quick reference
- Examine the Prisma schema for data model details
