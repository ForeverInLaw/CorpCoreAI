# Walkthrough - Telegram Bot & WebApp

## Prerequisites

- Docker & Docker Compose
- Telegram Bot Token (from @BotFather)
- Nvidia API Key (for AI)

## Setup

1.  **Environment Variables**:
    The `.env` file has been created. You must fill in the following values:

    ```env
    DATABASE_URL="postgresql://postgres:postgres@db:5432/corpcoreai?schema=public"
    BOT_TOKEN="your_telegram_bot_token"
    NVIDIA_API_KEY="your_nvidia_api_key"
    WHITELIST="123456789,987654321" # Comma-separated Telegram User IDs allowed in bot + WebApp
    MANAGER_IDS="123456789" # Optional: subset of whitelist with manager rights
    ```

2.  **Run with Docker**:
    ```bash
    docker-compose up --build
    ```
    This will start:
    - PostgreSQL Database
    - Next.js WebApp (http://localhost:3000)
    - Telegram Bot
    - Reminder worker (runs `pnpm reminders` daily at 08:00 MSK)

## Usage

### Bot

1.  Start the bot in Telegram.
2.  Send a text message describing a task (e.g., "Prepare monthly report by Friday").
3.  The bot will use AI to generate a title and subtasks, then save it to the database.
4.  **Note**: you must be in the `WHITELIST`. Managers (IDs in `MANAGER_IDS`) can assign tasks to any employee via inline buttons; employees create tasks for themselves.
5.  Deadlines: the bot first tries to detect a date in the original message (supports ISO, DD.MM.YYYY, relative phrases). If missing, it will prompt for a date and validates the reply. When AI infers a deadline, it is included automatically in the created task.
6.  Notifications: reminders are sent automatically — ежедневные напоминания, предупреждение за сутки до дедлайна, уведомление в день дедлайна, а также уведомления о просрочках (с эскалацией менеджеру). Логику выполняет скрипт `scripts/reminders.ts`.

### WebApp

1.  Open [http://localhost:3000](http://localhost:3000) **inside Telegram WebApp**.
2.  **Authentication & Access Control**:
    - The app strictly requires Telegram context and validates `initData`.
    - Only users from `WHITELIST` may load data; others see an "Access Restricted" message.
    - UI adapts to role: managers get employee filters, aggregated tasks; employees only see their own tasks.
3.  **Dashboard & Attachments**
    - Shows all task statuses (In Progress, Done, Paused, Overdue, Closed), assignee/creator labels, deadline indicators (with an "Overdue" badge when appropriate), and retry handling for transient fetch errors.
    - File uploads from the WebApp are stored privately under `storage/uploads` (never exposed via `public`).
    - Clicking an attachment triggers `POST /api/attachments/[attachmentId]/token`, which validates auth/permissions and returns a download URL valid for 5 minutes.
    - The browser immediately opens `GET /api/attachments/download/[token]`, which proxies Telegram files or streams the private file path, then invalidates the token so links cannot be reused.
    - Unauthorized users cannot obtain tokens, so even a leaked URL expires quickly and becomes unusable.

## Development

To run locally without Docker:

1.  Start DB (e.g., via Docker or local Postgres).
2.  Update `DATABASE_URL` in `.env` to point to localhost.
3.  Run migrations: `npx prisma migrate dev`.
4.  Start App: `pnpm run dev`.
5.  Start Bot: `npx tsx scripts/bot.ts`.
6.  Run reminders manually (optional): `pnpm reminders` — можно повесить cron, если не используете docker-compose worker.
