FROM node:22-alpine AS base
RUN npm install -g pnpm

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm i

FROM base AS builder
WORKDIR /app
ENV DATABASE_URL="postgresql://x:x@localhost:5432/x"
ENV BOT_TOKEN="build-placeholder"
ENV NVIDIA_API_KEY="build-placeholder"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && pnpm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 4174
ENV PORT=4174
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

FROM base AS bot-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --prod

FROM base AS bot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=bot-deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/proto ./proto

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["npx", "tsx", "scripts/bot.ts"]
