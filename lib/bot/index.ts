import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy'
import { TaskCompletionReviewStatus } from '@prisma/client'
import type { Prisma, TaskStatus, User } from '@prisma/client'
import type { Document, PhotoSize } from 'grammy/types'
import { prisma } from '../db'
import { parseTask } from '../ai'
import { ensureTelegramUser } from '../users'
import { saveTelegramAttachment } from '../attachments'
import { transcribeVoice } from '../voice-transcribe'
import {
  logTaskHistory,
  type TaskHistoryDetails,
  type TaskHistoryType,
} from '../task-history'

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is not defined')
}

function parseIsoDeadline(deadlineIso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadlineIso)
  if (!match) {
    return null
  }

  const [, yearRaw, monthRaw, dayRaw] = match
  const candidate = createUtcDate(
    Number(yearRaw),
    Number(monthRaw),
    Number(dayRaw),
  )
  if (!candidate) {
    return null
  }

  return ensureFutureOrToday(candidate)
}

type BotContext = Context & { user: User }

export const bot: Bot<BotContext> = new Bot(process.env.BOT_TOKEN)

const whitelist = new Set(
  (process.env.WHITELIST || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number)
    .filter((id) => !Number.isNaN(id)),
)

type TaskDraftBase = {
  title: string
  description: string
  subtasks: string[]
}

type TaskDraftWithDeadline = TaskDraftBase & {
  deadline: Date
}

const TASK_RELATIONS = {
  assignee: true,
  creator: true,
  assignments: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  tags: {
    include: { tag: true },
  },
  projects: {
    include: { project: true },
  },
} satisfies Prisma.TaskInclude

type TaskWithRelations = Prisma.TaskGetPayload<{
  include: typeof TASK_RELATIONS
}>

type TimedEntry<T> = T & { createdAt: number }

function timed<T>(value: T): TimedEntry<T> {
  return { ...value, createdAt: Date.now() }
}

function cleanupMap<K, T>(map: Map<K, TimedEntry<T>>, ttlMs: number) {
  const now = Date.now()
  for (const [key, entry] of map) {
    if (now - entry.createdAt > ttlMs) {
      map.delete(key)
    }
  }
}

const pendingManagerTasks = new Map<number, TimedEntry<TaskDraftWithDeadline>>()
const pendingDeadlineRequests = new Map<number, TimedEntry<TaskDraftBase>>()
const pendingAttachmentUploads = new Map<
  number,
  TimedEntry<{ taskId: number }>
>()
const pendingTaskDeadlineAdjustments = new Map<
  number,
  TimedEntry<{
    taskId: number
    stage: 'reason' | 'deadline'
    reason?: string
    initiatedByManager: boolean
  }>
>()

const MAPS_TTL_MS = 30 * 60 * 1000
setInterval(() => {
  cleanupMap(pendingManagerTasks, MAPS_TTL_MS)
  cleanupMap(pendingDeadlineRequests, MAPS_TTL_MS)
  cleanupMap(pendingAttachmentUploads, MAPS_TTL_MS)
  cleanupMap(pendingTaskDeadlineAdjustments, MAPS_TTL_MS)
}, MAPS_TTL_MS)

const mainKeyboard = new Keyboard()
  .text('Мои задачи')
  .row()
  .text('Прикрепить файл')
  .resized()
const TASKS_PAGE_SIZE = 10
const ATTACHABLE_STATUSES: TaskStatus[] = ['IN_PROGRESS', 'PAUSED', 'OVERDUE']
const STATUS_ACTIONS: TaskStatus[] = ['IN_PROGRESS', 'PAUSED', 'DONE']
const STATUS_LABELS: Record<TaskStatus, string> = {
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  OVERDUE: 'Просрочена',
  DONE: 'Готово',
  CLOSED: 'Закрыта',
}
const EMPLOYEE_FORBIDDEN_STATUSES = new Set<TaskStatus>(['CLOSED'])
const REVIEW_ACTIONS = new Set(['APPROVE', 'REJECT'] as const)

type AttachmentTaskAccess = {
  id: number
  creatorId: bigint
  assigneeId: bigint | null
  assignments: { userId: bigint }[]
}

type AttachmentTaskSummary = AttachmentTaskAccess & {
  title: string
  status: TaskStatus
}

type TaskAccessInfo = {
  creatorId: bigint
  assigneeId: bigint | null
  assignments: { userId: bigint }[]
}

function hasTaskAccess(task: TaskAccessInfo, user: User): boolean {
  if (user.role === 'MANAGER') return true
  if (task.creatorId === user.id) return true
  if (task.assigneeId === user.id) return true
  if (task.assignments?.some((a) => a.userId === user.id)) return true
  return false
}

type TaskListResult = {
  tasks: AttachmentTaskSummary[]
  hasNext: boolean
}

type TelegramFileDescriptor = {
  fileId: string
  uniqueFileId?: string | null
  fileName?: string | null
  mimeType?: string | null
  size?: number | null
}

const DEADLINE_PROMPT_MESSAGE =
  'Дедлайн не найден. Пожалуйста, отправьте дату в формате YYYY-MM-DD или DD.MM.YYYY (. / допускается).'
const DEADLINE_INVALID_MESSAGE =
  'Не удалось распознать дату или она уже прошла. Укажите дедлайн в формате YYYY-MM-DD или DD.MM.YYYY.'
const ATTACHMENT_INSTRUCTIONS =
  'Пришлите документ или изображение — я привяжу его к задаче.'
const TASK_EMPTY_MESSAGE =
  'У вас пока нет задач, к которым можно прикрепить файл.'
const MONTH_NAME_MAP: Record<string, number> = {
  января: 1,
  январь: 1,
  янв: 1,
  февраля: 2,
  февраль: 2,
  фев: 2,
  марта: 3,
  март: 3,
  мар: 3,
  апреля: 4,
  апрель: 4,
  апр: 4,
  мая: 5,
  май: 5,
  июн: 6,
  июня: 6,
  июль: 7,
  июля: 7,
  июл: 7,
  августа: 8,
  август: 8,
  авг: 8,
  сентября: 9,
  сентябрь: 9,
  сен: 9,
  октября: 10,
  октябрь: 10,
  окт: 10,
  ноября: 11,
  ноябрь: 11,
  ноя: 11,
  декабря: 12,
  декабрь: 12,
  дек: 12,
}

const WEEKDAY_NAME_MAP: Record<string, number> = {
  понедельник: 1,
  понедельника: 1,
  пн: 1,
  вторник: 2,
  вторника: 2,
  вт: 2,
  среда: 3,
  среды: 3,
  среду: 3,
  ср: 3,
  четверг: 4,
  четверга: 4,
  чт: 4,
  пятница: 5,
  пятницы: 5,
  пятницу: 5,
  пт: 5,
  суббота: 6,
  субботы: 6,
  сб: 6,
  воскресенье: 0,
  воскресенья: 0,
  вс: 0,
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, String.raw`\$1`)
}

function formatDeadlineForDisplay(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${day}.${month}.${year}`
}

function createUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function ensureFutureOrToday(date: Date): Date | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const normalized = new Date(date)
  return normalized >= today ? normalized : null
}

function extractDeadlineFromText(text: string): Date | null {
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text)
  if (isoMatch) {
    const [, yearRaw, monthRaw, dayRaw] = isoMatch
    const candidate = createUtcDate(
      Number(yearRaw),
      Number(monthRaw),
      Number(dayRaw),
    )
    if (candidate) {
      const valid = ensureFutureOrToday(candidate)
      if (valid) return valid
    }
  }

  const dmyMatch = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/.exec(text)
  if (dmyMatch) {
    const [, dayRaw, monthRaw, yearRaw] = dmyMatch
    const candidate = createUtcDate(
      Number(yearRaw),
      Number(monthRaw),
      Number(dayRaw),
    )
    if (candidate) {
      const valid = ensureFutureOrToday(candidate)
      if (valid) return valid
    }
  }

  const dmMatch = /\b(\d{1,2})[./](\d{1,2})\b/.exec(text)
  if (dmMatch) {
    const [, dayRaw, monthRaw] = dmMatch
    const now = new Date()
    const year = now.getUTCFullYear()
    let candidate = createUtcDate(year, Number(monthRaw), Number(dayRaw))
    if (candidate) {
      if (ensureFutureOrToday(candidate)) {
        return candidate
      }
      candidate = createUtcDate(year + 1, Number(monthRaw), Number(dayRaw))
      if (candidate) {
        const valid = ensureFutureOrToday(candidate)
        if (valid) return valid
      }
    }
  }

  const relative = extractRelativeDeadline(text)
  if (relative) {
    return relative
  }

  return null
}

function parseUserDeadlineInput(rawText: string): Date | null {
  const direct = parseIsoDeadline(rawText.trim())
  if (direct) {
    return direct
  }

  return extractDeadlineFromText(rawText)
}

function extractRelativeDeadline(rawText: string): Date | null {
  const text = rawText.toLowerCase()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  if (/(сегодня)/i.test(text)) {
    return new Date(today)
  }

  if (/(завтра)/i.test(text)) {
    return addUtcDays(today, 1)
  }

  if (/(послезавтра)/i.test(text)) {
    return addUtcDays(today, 2)
  }

  const inDaysMatch = /через\s+(\d+)\s+(дн(?:я|ей)|дня|дней)/.exec(text)
  if (inDaysMatch) {
    const daysAhead = Number(inDaysMatch[1])
    if (!Number.isNaN(daysAhead) && daysAhead >= 0) {
      return addUtcDays(today, daysAhead)
    }
  }

  const inWeeksMatch = /через\s+(\d+)\s+недел[юи]/.exec(text)
  if (inWeeksMatch) {
    const weeksAhead = Number(inWeeksMatch[1])
    if (!Number.isNaN(weeksAhead) && weeksAhead >= 0) {
      return addUtcDays(today, weeksAhead * 7)
    }
  }

  const weekdayMatch = /\b(?:до|к|на|в)\s+(понедельника|понедельник|пн|вторника|вторник|вт|сред[ауы]|ср|четверг|четверга|чт|пятниц[ауы]?|пт|суббот[ауы]?|сб|воскресень[ея]|вс)\b/.exec(text)
  if (weekdayMatch) {
    const weekdayRaw = weekdayMatch[1]
    const weekdayIndex =
      WEEKDAY_NAME_MAP[weekdayRaw]
    if (weekdayIndex !== undefined) {
      return getUpcomingWeekday(today, weekdayIndex)
    }
  }

  const monthMatch = /\b(?:до|к|на)?\s*(\d{1,2})\s+(январ[ья]|феврал[ья]|марта?|апрел[ья]|мая|июн[ья]|июл[ья]|авгус[та]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\b/.exec(text)
  if (monthMatch) {
    const day = Number(monthMatch[1])
    const monthName = monthMatch[2]
    const month = MONTH_NAME_MAP[monthName]
    if (!Number.isNaN(day) && month) {
      const date = createDateWithMonthName(today, day, month)
      if (date) return date
    }
  }

  if (/через\s+несколько\s+дней/.test(text)) {
    return addUtcDays(today, 3)
  }

  if (/(после\s+завтра)/.test(text)) {
    return addUtcDays(today, 2)
  }

  return null
}

function createDateWithMonthName(
  reference: Date,
  day: number,
  month: number,
): Date | null {
  const candidate = createUtcDate(reference.getUTCFullYear(), month, day)
  if (!candidate) return null

  const valid = ensureFutureOrToday(candidate)
  if (valid) {
    return valid
  }

  return createUtcDate(reference.getUTCFullYear() + 1, month, day)
}

function getUpcomingWeekday(reference: Date, targetWeekday: number): Date {
  const currentWeekday = reference.getUTCDay()
  let diff = (targetWeekday - currentWeekday + 7) % 7
  if (diff === 0) {
    diff = 7
  }
  return addUtcDays(reference, diff)
}

function addUtcDays(reference: Date, days: number): Date {
  const clone = new Date(reference)
  clone.setUTCDate(clone.getUTCDate() + days)
  clone.setUTCHours(0, 0, 0, 0)
  return clone
}

function normalizeStartOfUtcDay(date: Date): Date {
  const normalized = new Date(date)
  normalized.setUTCHours(0, 0, 0, 0)
  return normalized
}

async function findTaskForAttachment(
  taskId: number,
): Promise<AttachmentTaskAccess | null> {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      assignments: {
        select: { userId: true },
      },
    },
  })
}

async function fetchAttachableTasks(
  user: User,
  page = 0,
): Promise<TaskListResult> {
  const skip = page * TASKS_PAGE_SIZE
  const take = TASKS_PAGE_SIZE + 1

  const raw = await prisma.task.findMany({
    where:
      user.role === 'MANAGER'
        ? {
            status: { in: ATTACHABLE_STATUSES },
          }
        : {
            status: { in: ATTACHABLE_STATUSES },
            OR: [
              { assigneeId: user.id },
              { creatorId: user.id },
              { assignments: { some: { userId: user.id } } },
            ],
          },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      title: true,
      status: true,
      assignments: {
        select: { userId: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip,
    take,
  })

  const hasNext = raw.length > TASKS_PAGE_SIZE
  const tasks = raw.slice(0, TASKS_PAGE_SIZE)

  return { tasks, hasNext }
}

function buildAttachmentKeyboard(
  tasks: AttachmentTaskSummary[],
  options: { page: number; hasPrev: boolean; hasNext: boolean },
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  tasks.forEach((task) => {
    const label = `#${task.id} · ${truncateTitle(task.title)} (${formatStatus(task.status)})`
    keyboard.text(label, `attach-task:${task.id}`).row()
  })

  if (options.hasPrev || options.hasNext) {
    if (options.hasPrev) {
      keyboard.text('← Назад', `attach-page:${options.page - 1}`)
    }
    if (options.hasNext) {
      keyboard.text('Вперёд →', `attach-page:${options.page + 1}`)
    }
    keyboard.row()
  }

  keyboard.text('Отмена', 'attach-cancel')
  return keyboard
}

function truncateTitle(title: string, max = 32): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title
}

function formatStatus(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status
}

function canAccessTask(task: TaskWithRelations, user: User): boolean {
  return hasTaskAccess(task, user)
}

function buildTaskSummaryMessage(task: TaskWithRelations): string {
  const creator = task.creator?.name ?? `ID ${task.creatorId.toString()}`
  const assignee =
    task.assignee?.name ??
    (task.assigneeId ? `ID ${task.assigneeId.toString()}` : 'Не назначена')
  const deadline = task.deadline ? formatDeadlineForDisplay(task.deadline) : '—'
  const teamDetails = task.assignments
    ?.map((assignment) => {
      const lead = assignment.isLead ? '⭐ ' : ''
      const name = assignment.user?.name ?? `ID ${assignment.userId.toString()}`
      return `${lead}${name}`
    })
    .join(', ')
  const tagDetails = task.tags?.map(({ tag }) => `#${tag.label}`).join(', ')
  const projectDetails = task.projects
    ?.map(({ project }) => project.name)
    .join(', ')

  const lines = [
    `#${task.id} · ${task.title}`,
    `Статус: ${formatStatus(task.status)}`,
    `Дедлайн: ${deadline}`,
    `Создатель: ${creator}`,
    `Исполнитель: ${assignee}`,
  ]

  if (teamDetails) {
    lines.push(`Команда: ${teamDetails}`)
  }

  if (projectDetails) {
    lines.push(`Проекты: ${projectDetails}`)
  }

  if (tagDetails) {
    lines.push(`Теги: ${tagDetails}`)
  }

  return lines.join('\n')
}

function buildTaskActionKeyboard(
  task: TaskWithRelations,
  user: User,
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  const statuses = [...STATUS_ACTIONS]
  if (user.role === 'MANAGER') {
    statuses.push('CLOSED')
  }

  statuses
    .filter((status) => status !== task.status)
    .forEach((status) => {
      keyboard
        .text(STATUS_LABELS[status], `task-status:${task.id}:${status}`)
        .row()
    })

  keyboard.text('Обновить дедлайн', `task-deadline:${task.id}`).row()

  if (
    task.status === 'OVERDUE' &&
    task.assigneeId &&
    task.assigneeId === user.id
  ) {
    keyboard.text('Объяснить просрочку', `task-overdue:${task.id}`).row()
  }

  if (task.status === 'DONE' && user.role === 'MANAGER') {
    keyboard
      .text('Подтвердить выполнение', `task-review:${task.id}:APPROVE`)
      .row()
    keyboard.text('Вернуть на доработку', `task-review:${task.id}:REJECT`).row()
  }

  keyboard.text('Прикрепить файл', `attach-task:${task.id}`).row()

  return keyboard
}

async function fetchTaskWithRelations(
  taskId: number,
): Promise<TaskWithRelations | null> {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: TASK_RELATIONS,
  })
}

async function sendTaskDetails(
  ctx: BotContext,
  task: TaskWithRelations,
  options: { edit?: boolean } = {},
) {
  const text = buildTaskSummaryMessage(task)
  const keyboard = buildTaskActionKeyboard(task, ctx.user)

  if (options.edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard })
  } else {
    await ctx.reply(text, { reply_markup: keyboard })
  }
}

async function fetchLatestTasksForUser(
  user: User,
  limit = 5,
): Promise<TaskWithRelations[]> {
  return prisma.task.findMany({
    where:
      user.role === 'MANAGER'
        ? undefined
        : {
            OR: [
              { creatorId: user.id },
              { assigneeId: user.id },
              { assignments: { some: { userId: user.id } } },
            ],
          },
    include: TASK_RELATIONS,
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })
}

async function sendTaskOverview(ctx: BotContext) {
  const tasks = await fetchLatestTasksForUser(ctx.user)
  if (tasks.length === 0) {
    await ctx.reply(
      'У вас пока нет задач. Создайте новую задачу в этом чате или через веб-приложение.',
    )
    return
  }

  const header = `Показываю последние ${tasks.length} задач(и). Нажмите на задачу, чтобы открыть детали.`
  const lines = tasks.map(
    (task) =>
      `#${task.id} · ${truncateTitle(task.title)} (${formatStatus(task.status)})`,
  )
  const keyboard = new InlineKeyboard()
  tasks.forEach((task) => {
    keyboard
      .text(
        `#${task.id} · ${truncateTitle(task.title, 22)}`,
        `task-view:${task.id}`,
      )
      .row()
  })

  await ctx.reply(`${header}\n\n${lines.join('\n')}`, {
    reply_markup: keyboard,
  })
}

async function handleTaskStatusChange(
  ctx: BotContext,
  taskId: number,
  nextStatus: TaskStatus,
) {
  const task = await fetchTaskWithRelations(taskId)
  if (!task) {
    await ctx.answerCallbackQuery({
      text: 'Задача не найдена',
      show_alert: true,
    })
    return
  }

  if (!canAccessTask(task, ctx.user)) {
    await ctx.answerCallbackQuery({
      text: 'Нет доступа к задаче',
      show_alert: true,
    })
    return
  }

  if (
    ctx.user.role !== 'MANAGER' &&
    EMPLOYEE_FORBIDDEN_STATUSES.has(nextStatus)
  ) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав для статуса',
      show_alert: true,
    })
    return
  }

  if (task.status === nextStatus) {
    await ctx.answerCallbackQuery({ text: 'Статус уже установлен' })
    return
  }

  const now = new Date()
  const updates: Prisma.TaskUpdateInput = {}
  const historyEntries: {
    type: TaskHistoryType
    details?: TaskHistoryDetails
  }[] = []
  const previousStatus = task.status
  const previousReviewStatus = task.completionReviewStatus
  let nextReviewStatus: TaskCompletionReviewStatus | null = null

  updates.status = nextStatus
  updates.statusChangedAt = now
  let completedAt: Date | null = null
  if (nextStatus === 'DONE') {
    completedAt = now
  } else if (nextStatus === 'CLOSED') {
    completedAt = task.completedAt ?? now
  }
  updates.completedAt = completedAt
  historyEntries.push({
    type: 'STATUS_CHANGE',
    details: {
      from: previousStatus,
      to: nextStatus,
    },
  })

  if (nextStatus === 'DONE') {
    if (ctx.user.role === 'MANAGER') {
      nextReviewStatus = TaskCompletionReviewStatus.APPROVED
      updates.completionReviewStatus = TaskCompletionReviewStatus.APPROVED
      updates.completionReviewedAt = now
      updates.completionReviewedBy = { connect: { id: ctx.user.id } }
      updates.completionRequestedAt = task.completionRequestedAt ?? now
    } else {
      nextReviewStatus = TaskCompletionReviewStatus.PENDING
      updates.completionReviewStatus = TaskCompletionReviewStatus.PENDING
      updates.completionRequestedAt = now
      updates.completionReviewedAt = null
      updates.completionReviewedBy = { disconnect: true }
    }
  } else {
    nextReviewStatus = TaskCompletionReviewStatus.NOT_REQUESTED
    updates.completionReviewStatus = TaskCompletionReviewStatus.NOT_REQUESTED
    updates.completionRequestedAt = null
    updates.completionReviewedAt = null
    updates.completionReviewedBy = { disconnect: true }
  }

  if (nextReviewStatus !== previousReviewStatus) {
    historyEntries.push({
      type: 'REVIEW_STATUS_CHANGE',
      details: {
        from: previousReviewStatus,
        to: nextReviewStatus,
        reason:
          nextStatus === 'DONE' && ctx.user.role !== 'MANAGER'
            ? 'REQUESTED_BY_ASSIGNEE'
            : 'STATUS_UPDATE',
      },
    })
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: updates,
    include: TASK_RELATIONS,
  })

  if (historyEntries.length > 0) {
    await Promise.all(
      historyEntries.map((entry) =>
        logTaskHistory({
          taskId: updated.id,
          actorId: ctx.user.id,
          type: entry.type,
          details: entry.details,
        }),
      ),
    )
  }

  await ctx.answerCallbackQuery({
    text: `Статус: ${STATUS_LABELS[nextStatus]}`,
  })
  await sendTaskDetails(ctx, updated, { edit: true })

  const actorName = ctx.user.name ?? `ID ${ctx.user.id.toString()}`
  const notifyMessage = `Статус задачи "${updated.title}" изменён на "${STATUS_LABELS[nextStatus]}" пользователем ${actorName}.`
  await broadcastTaskNotification(updated, notifyMessage, ctx.user.id)
}

export async function sendTelegramNotification(
  userId: bigint | null | undefined,
  message: string,
) {
  if (!userId) return

  try {
    await bot.api.sendMessage(Number(userId), message)
  } catch (error) {
    console.error('Failed to send Telegram notification', {
      userId: userId.toString(),
      error,
    })
  }
}

export async function broadcastTaskNotification(
  task: TaskWithRelations,
  message: string,
  excludeUserId?: bigint,
) {
  const recipients = new Set<bigint>()

  if (task.creatorId) recipients.add(task.creatorId)
  if (task.assigneeId) recipients.add(task.assigneeId)

  task.assignments?.forEach((a) => recipients.add(a.userId))

  if (excludeUserId) {
    recipients.delete(excludeUserId)
  }

  await Promise.all(
    Array.from(recipients).map((id) => sendTelegramNotification(id, message)),
  )
}

async function handleReviewAction(
  ctx: BotContext,
  taskId: number,
  action: 'APPROVE' | 'REJECT',
) {
  const task = await fetchTaskWithRelations(taskId)
  if (!task) {
    await ctx.answerCallbackQuery({
      text: 'Задача не найдена',
      show_alert: true,
    })
    return
  }

  if (task.status !== 'DONE') {
    await ctx.answerCallbackQuery({
      text: 'Задача не готова к проверке',
      show_alert: true,
    })
    return
  }

  if (task.completionReviewStatus !== TaskCompletionReviewStatus.PENDING) {
    await ctx.answerCallbackQuery({
      text: 'Нет запроса на подтверждение',
      show_alert: true,
    })
    return
  }

  const now = new Date()
  const updates: Prisma.TaskUpdateInput = {}
  const historyEntries: {
    type: TaskHistoryType
    details?: TaskHistoryDetails
  }[] = []
  const previousStatus = task.status
  const previousReviewStatus = task.completionReviewStatus
  const resultingStatus: TaskStatus =
    action === 'APPROVE' ? 'CLOSED' : 'IN_PROGRESS'

  if (action === 'APPROVE') {
    updates.status = resultingStatus
    updates.completedAt = task.completedAt ?? now
    updates.completionReviewStatus = TaskCompletionReviewStatus.APPROVED
    updates.completionReviewedAt = now
    updates.completionReviewedBy = { connect: { id: ctx.user.id } }
    updates.completionRequestedAt =
      task.completionRequestedAt ?? task.completedAt ?? now
  } else {
    updates.status = resultingStatus
    updates.completedAt = null
    updates.completionReviewStatus = TaskCompletionReviewStatus.REJECTED
    updates.completionReviewedAt = now
    updates.completionReviewedBy = { connect: { id: ctx.user.id } }
  }

  historyEntries.push(
    {
      type: 'STATUS_CHANGE',
      details: {
        from: previousStatus,
        to: resultingStatus,
      },
    },
    {
      type: 'REVIEW_STATUS_CHANGE',
      details: {
        from: previousReviewStatus,
        to: updates.completionReviewStatus,
        reason: action,
      },
    },
  )

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: updates,
    include: TASK_RELATIONS,
  })

  await Promise.all(
    historyEntries.map((entry) =>
      logTaskHistory({
        taskId: updated.id,
        actorId: ctx.user.id,
        type: entry.type,
        details: entry.details,
      }),
    ),
  )

  const responseText =
    action === 'APPROVE'
      ? 'Результат подтверждён, задача закрыта'
      : 'Задача возвращена на доработку'

  await ctx.answerCallbackQuery({ text: responseText })
  await sendTaskDetails(ctx, updated, { edit: true })

  const actorName = ctx.user.name ?? `ID ${ctx.user.id.toString()}`
  const notifyMessage =
    action === 'APPROVE'
      ? `Задача "${updated.title}" закрыта. Менеджер ${actorName} подтвердил выполнение.`
      : `Задача "${updated.title}" возвращена на доработку менеджером ${actorName}. Проверьте комментарии и обновите статус.`

  await broadcastTaskNotification(updated, notifyMessage, ctx.user.id)
}

async function beginDeadlineAdjustment(
  ctx: BotContext,
  taskId: number,
  options: { requireReason: boolean },
) {
  const task = await fetchTaskWithRelations(taskId)
  if (!task) {
    await ctx.answerCallbackQuery({
      text: 'Задача не найдена',
      show_alert: true,
    })
    return
  }

  if (!canAccessTask(task, ctx.user)) {
    await ctx.answerCallbackQuery({
      text: 'Нет доступа к задаче',
      show_alert: true,
    })
    return
  }

  pendingTaskDeadlineAdjustments.set(
    ctx.from!.id,
    timed({
      taskId: task.id,
      stage: options.requireReason ? 'reason' : 'deadline',
      initiatedByManager: !options.requireReason,
    }),
  )

  if (options.requireReason) {
    await ctx.reply(
      'Опишите причину просрочки текстом. После этого я попрошу новый дедлайн.',
    )
  } else {
    await ctx.reply(
      'Отправьте новый дедлайн в формате YYYY-MM-DD или DD.MM.YYYY.',
    )
  }

  await ctx.answerCallbackQuery()
}

async function completeDeadlineAdjustment(
  ctx: BotContext,
  entry: {
    taskId: number
    stage: 'reason' | 'deadline'
    reason?: string
    initiatedByManager: boolean
  },
  newDeadline: Date,
) {
  const task = await fetchTaskWithRelations(entry.taskId)
  if (!task) {
    pendingTaskDeadlineAdjustments.delete(ctx.from!.id)
    await ctx.reply('Задача не найдена. Попробуйте начать сначала.')
    return
  }

  if (!canAccessTask(task, ctx.user)) {
    pendingTaskDeadlineAdjustments.delete(ctx.from!.id)
    await ctx.reply('У вас больше нет доступа к этой задаче.')
    return
  }

  const normalizedDeadline = normalizeStartOfUtcDay(newDeadline)
  const updates: Prisma.TaskUpdateInput = {
    deadline: normalizedDeadline,
    lastDailyReminderAt: null,
    lastDeadlineReminderAt: null,
    deadlineDayNotifiedAt: null,
    overdueNotifiedAt: null,
    managerOverdueNotifiedAt: null,
    overdueReason: entry.reason ?? null,
  }

  let statusReset = false
  if (task.status === 'OVERDUE') {
    updates.status = 'IN_PROGRESS'
    updates.statusChangedAt = new Date()
    statusReset = true
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: updates,
    include: TASK_RELATIONS,
  })

  pendingTaskDeadlineAdjustments.delete(ctx.from!.id)

  const deadlineText = formatDeadlineForDisplay(normalizedDeadline)
  const statusNote = statusReset ? ' Статус возвращён в «В работе».' : ''
  await ctx.reply(`Дедлайн обновлён: ${deadlineText}.${statusNote}`)
  await sendTaskDetails(ctx, updated)

  const historyEntries: {
    type: 'DEADLINE_CHANGE' | 'STATUS_CHANGE' | 'OVERDUE_REASON'
    details?: TaskHistoryDetails
  }[] = []
  const previousDeadlineIso = task.deadline ? task.deadline.toISOString() : null
  const newDeadlineIso = normalizedDeadline.toISOString()

  if (previousDeadlineIso !== newDeadlineIso || entry.reason) {
    historyEntries.push({
      type: 'DEADLINE_CHANGE',
      details: {
        from: previousDeadlineIso,
        to: newDeadlineIso,
      },
    })
  }

  if (statusReset) {
    historyEntries.push({
      type: 'STATUS_CHANGE',
      details: {
        from: task.status,
        to: 'IN_PROGRESS',
      },
    })
  }

  if (entry.reason) {
    historyEntries.push({
      type: 'OVERDUE_REASON',
      details: {
        reason: entry.reason,
        previousDeadline: previousDeadlineIso,
        newDeadline: newDeadlineIso,
      },
    })
  }

  if (historyEntries.length > 0) {
    await Promise.all(
      historyEntries.map((entryDetails) =>
        logTaskHistory({
          taskId: updated.id,
          actorId: ctx.user.id,
          type: entryDetails.type,
          details: entryDetails.details,
        }),
      ),
    )
  }

  if (entry.reason) {
    const actorName =
      ctx.user.name || ctx.from?.first_name || `ID ${ctx.user.id.toString()}`
    const notification = [
      `Задача "${updated.title}" получила новый дедлайн (${deadlineText}).`,
      `Исполнитель ${actorName} пояснил причину: ${entry.reason}`,
    ].join('\n')

    const recipients = new Set<bigint>()

    if (updated.creatorId !== ctx.user.id) {
      recipients.add(updated.creatorId)
    }
    if (updated.assigneeId && updated.assigneeId !== ctx.user.id) {
      recipients.add(updated.assigneeId)
    }
    updated.assignments?.forEach((a) => {
      if (a.userId !== ctx.user.id) recipients.add(a.userId)
    })

    if (updated.creator?.role !== 'MANAGER') {
      const excludedIds: bigint[] = [ctx.user.id]
      if (updated.creatorId !== ctx.user.id) {
        excludedIds.push(updated.creatorId)
      }

      const managerUsers = await prisma.user.findMany({
        where: {
          role: 'MANAGER',
          id: {
            notIn: excludedIds,
          },
        },
        select: { id: true },
      })

      managerUsers.forEach((manager) => {
        recipients.add(manager.id)
      })
    }

    await Promise.all(
      Array.from(recipients).map(async (recipientId) => {
        try {
          await bot.api.sendMessage(Number(recipientId), notification)
        } catch (error) {
          console.error('Failed to notify about overdue reason', {
            recipientId: recipientId.toString(),
            error,
          })
        }
      }),
    )
  }
}

function buildTaskListMessage(
  tasks: AttachmentTaskSummary[],
  page: number,
): string {
  const header = `Актуальные задачи (страница ${page + 1})`
  const lines = tasks.map(
    (task) => `#${task.id} · ${task.title} (${formatStatus(task.status)})`,
  )
  return `${header}\n${lines.join('\n')}\n\nЧтобы прикрепить файл, выберите задачу ниже:`
}

async function sendAttachmentTaskList(
  ctx: BotContext,
  page = 0,
  options: { edit?: boolean } = {},
) {
  const { edit = false } = options
  const result = await fetchAttachableTasks(ctx.user, page)

  if (result.tasks.length === 0) {
    if (page > 0) {
      await sendAttachmentTaskList(ctx, page - 1, options)
      return
    }

    if (edit && ctx.callbackQuery?.message) {
      await ctx.editMessageText(TASK_EMPTY_MESSAGE)
    } else {
      await ctx.reply(TASK_EMPTY_MESSAGE, { reply_markup: mainKeyboard })
    }
    return
  }

  const text = buildTaskListMessage(result.tasks, page)
  const keyboard = buildAttachmentKeyboard(result.tasks, {
    page,
    hasPrev: page > 0,
    hasNext: result.hasNext,
  })

  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard })
  } else {
    await ctx.reply(text, { reply_markup: keyboard })
  }
}

function canUploadAttachment(task: AttachmentTaskAccess, user: User): boolean {
  return hasTaskAccess(task, user)
}

function descriptorFromDocument(
  document?: Document,
): TelegramFileDescriptor | null {
  if (!document) return null

  return {
    fileId: document.file_id,
    uniqueFileId: document.file_unique_id,
    fileName: document.file_name ?? undefined,
    mimeType: document.mime_type ?? undefined,
    size: document.file_size ?? undefined,
  }
}

function descriptorFromPhoto(
  photoSizes?: PhotoSize[],
): TelegramFileDescriptor | null {
  if (!photoSizes?.length) return null

  const largest = photoSizes.at(-1)
  if (!largest) return null
  return {
    fileId: largest.file_id,
    uniqueFileId: largest.file_unique_id,
    mimeType: 'image/jpeg',
    size: largest.file_size ?? undefined,
  }
}

async function handleIncomingAttachment(
  ctx: BotContext,
  descriptor: TelegramFileDescriptor | null,
) {
  if (!ctx.from) return

  const pending = pendingAttachmentUploads.get(ctx.from.id)
  if (!pending) {
    await ctx.reply(
      'Чтобы прикрепить файл, сначала используйте команду /attach <ID задачи>.',
    )
    return
  }

  if (!descriptor) {
    await ctx.reply(
      'Не удалось прочитать файл. Попробуйте отправить его еще раз.',
    )
    return
  }

  const task = await findTaskForAttachment(pending.taskId)
  if (!task) {
    pendingAttachmentUploads.delete(ctx.from.id)
    await ctx.reply('Задача не найдена. Попробуйте заново.')
    return
  }

  if (!canUploadAttachment(task, ctx.user)) {
    pendingAttachmentUploads.delete(ctx.from.id)
    await ctx.reply('У вас нет прав прикреплять файлы к этой задаче.')
    return
  }

  try {
    const attachment = await saveTelegramAttachment({
      taskId: pending.taskId,
      uploadedById: BigInt(ctx.from.id),
      telegramFileId: descriptor.fileId,
      telegramUniqueFileId: descriptor.uniqueFileId,
      fileName: descriptor.fileName,
      mimeType: descriptor.mimeType,
      sizeBytes: descriptor.size ?? undefined,
    })

    await notifyTeamAboutAttachment({
      taskId: pending.taskId,
      uploader: ctx.user,
      attachment,
    })

    pendingAttachmentUploads.delete(ctx.from.id)
    await ctx.reply('Файл сохранен и привязан к задаче.')
  } catch (error) {
    console.error('Failed to save attachment', error)
    await ctx.reply('Не удалось сохранить файл. Попробуйте позже.')
  }
}

async function notifyTeamAboutAttachment({
  taskId,
  uploader,
  attachment,
}: {
  taskId: number
  uploader: User
  attachment: { fileName?: string | null; type: string | null }
}) {
  const task = await fetchTaskWithRelations(taskId)

  if (!task) {
    return
  }

  const uploaderName = uploader.name ?? `ID ${uploader.id.toString()}`
  const attachmentLabel = attachment.fileName ?? attachment.type ?? 'файл'
  const message = [
    `Задача "${task.title}" получила новый файл: ${attachmentLabel}.`,
    `Загрузил: ${uploaderName}.`,
  ].join('\n')

  await broadcastTaskNotification(task, message, uploader.id)
}

async function handleDraftWithDeadline(
  ctx: BotContext,
  draft: TaskDraftWithDeadline,
) {
  if (!ctx.from) {
    return
  }

  const userId = ctx.from.id
  if (ctx.user.role === 'MANAGER') {
    const employees = await prisma.user.findMany({
      where: { role: 'EMPLOYEE' },
      orderBy: [{ name: 'asc' }],
      take: 25,
    })

    if (employees.length === 0) {
      await ctx.reply(
        'Сотрудники не найдены. Задача назначена вам по умолчанию.',
      )
      await createTaskForAssignee(ctx, draft, BigInt(userId))
      return
    }

    pendingManagerTasks.set(userId, timed(draft))

    const keyboard = new InlineKeyboard()

    employees.forEach((employee, index) => {
      const label = employee.name || `ID ${employee.id.toString()}`
      keyboard.text(label, `assign:${employee.id.toString()}`)
      if ((index + 1) % 2 === 0) {
        keyboard.row()
      }
    })

    keyboard.text('Назначить мне', 'assign:self').row()
    keyboard.text('Отмена', 'assign:cancel')

    await ctx.reply('Выберите исполнителя для задачи (или «Назначить мне»).', {
      reply_markup: keyboard,
    })
    return
  }

  await createTaskForAssignee(ctx, draft, BigInt(userId))
}

async function createTaskForAssignee(
  ctx: BotContext,
  draft: TaskDraftWithDeadline,
  assigneeId: bigint,
) {
  if (!ctx.from) {
    return
  }

  const creatorId = BigInt(ctx.from.id)
  const task = await prisma.task.create({
    data: {
      title: draft.title,
      description: draft.description,
      creatorId,
      assigneeId,
      subtasks: draft.subtasks,
      status: 'IN_PROGRESS',
      deadline: draft.deadline,
    },
  })

  const subtaskList =
    draft.subtasks.map((s: string) => `- ${escapeMarkdown(s)}`).join('\n') ||
    '—'
  const message = `Задача создана!\n\n*${escapeMarkdown(task.title)}*\nДедлайн: ${formatDeadlineForDisplay(draft.deadline)}\n\nПодзадачи:\n${subtaskList}`

  await ctx.reply(message, { parse_mode: 'Markdown' })
}

function parseAssigneeId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) {
    return null
  }
  try {
    return BigInt(raw)
  } catch {
    return null
  }
}

// Whitelist Middleware
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id
  if (!userId) return

  const userBigInt = BigInt(userId)
  let user = await prisma.user.findUnique({ where: { id: userBigInt } })

  if (user) {
    user = await ensureTelegramUser({
      id: String(userId),
      name: ctx.from?.first_name,
    })
  } else {
    if (!whitelist.has(userId)) {
      await ctx.reply('Доступ запрещен. Вас нет в белом списке.')
      return
    }

    user = await ensureTelegramUser({
      id: String(userId),
      name: ctx.from?.first_name,
    })
  }

  ctx.user = user

  await next()
})

bot.command('start', (ctx) =>
  ctx.reply('Добро пожаловать! Отправьте мне описание задачи.', {
    reply_markup: mainKeyboard,
  }),
)

bot.hears('Мои задачи', async (ctx) => {
  if (!ctx.from) return

  await sendTaskOverview(ctx)
})

bot.hears('Прикрепить файл', async (ctx) => {
  if (!ctx.from) return

  await sendAttachmentTaskList(ctx)
})

bot.on('message:text', async (ctx) => {
  if (!ctx.from) return

  const text = ctx.message.text?.trim()
  if (!text) return

  const userId = ctx.from.id
  const pendingDeadline = pendingDeadlineRequests.get(userId)
  const pendingAdjustment = pendingTaskDeadlineAdjustments.get(userId)

  if (pendingAdjustment) {
    if (pendingAdjustment.stage === 'reason') {
      if (!text) {
        await ctx.reply('Причина не может быть пустой. Попробуйте ещё раз.')
        return
      }
      pendingTaskDeadlineAdjustments.set(
        userId,
        timed({
          ...pendingAdjustment,
          stage: 'deadline',
          reason: text,
        }),
      )
      await ctx.reply(
        'Спасибо. Теперь отправьте новый дедлайн (YYYY-MM-DD или DD.MM.YYYY).',
      )
      return
    }

    const parsedDeadline = parseUserDeadlineInput(text)
    if (!parsedDeadline) {
      await ctx.reply(DEADLINE_INVALID_MESSAGE)
      return
    }

    await completeDeadlineAdjustment(ctx, pendingAdjustment, parsedDeadline)
    return
  }

  if (pendingDeadline) {
    const parsedDeadline = extractDeadlineFromText(text)
    if (!parsedDeadline) {
      await ctx.reply(DEADLINE_INVALID_MESSAGE)
      return
    }

    pendingDeadlineRequests.delete(userId)
    await handleDraftWithDeadline(ctx, {
      ...pendingDeadline,
      deadline: parsedDeadline,
    })
    return
  }

  await ctx.reply('Анализирую задачу...')

  try {
    const { title, subtasks, deadline: aiDeadline } = await parseTask(text)
    let detectedDeadline = aiDeadline ? parseIsoDeadline(aiDeadline) : null
    detectedDeadline ??= extractDeadlineFromText(text)
    const draft: TaskDraftBase = {
      title,
      description: text,
      subtasks,
    }

    if (!detectedDeadline) {
      pendingDeadlineRequests.set(userId, timed(draft))
      await ctx.reply(DEADLINE_PROMPT_MESSAGE)
      return
    }

    await handleDraftWithDeadline(ctx, { ...draft, deadline: detectedDeadline })
  } catch (error) {
    console.error(error)
    await ctx.reply('Не удалось создать задачу. Попробуйте ещё раз.')
  }
})

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data

  if (!data || !ctx.from) {
    await ctx.answerCallbackQuery()
    return
  }

  if (data.startsWith('task-view:')) {
    const [, taskIdRaw] = data.split(':')
    const taskId = Number(taskIdRaw)
    if (!Number.isInteger(taskId)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректный ID задачи',
        show_alert: true,
      })
      return
    }

    const task = await fetchTaskWithRelations(taskId)
    if (!task) {
      await ctx.answerCallbackQuery({
        text: 'Задача не найдена',
        show_alert: true,
      })
      return
    }

    if (!canAccessTask(task, ctx.user)) {
      await ctx.answerCallbackQuery({
        text: 'Нет доступа к задаче',
        show_alert: true,
      })
      return
    }

    await sendTaskDetails(ctx, task)
    await ctx.answerCallbackQuery()
    return
  }

  if (data.startsWith('task-status:')) {
    const [, taskIdRaw, statusRaw] = data.split(':')
    const taskId = Number(taskIdRaw)
    if (!Number.isInteger(taskId) || !statusRaw) {
      await ctx.answerCallbackQuery({
        text: 'Некорректный запрос',
        show_alert: true,
      })
      return
    }

    const validStatuses = new Set<TaskStatus>([
      ...STATUS_ACTIONS,
      'OVERDUE',
      'CLOSED',
    ])
    if (!validStatuses.has(statusRaw as TaskStatus)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректный статус',
        show_alert: true,
      })
      return
    }

    await handleTaskStatusChange(ctx, taskId, statusRaw as TaskStatus)
    return
  }

  if (data.startsWith('task-deadline:')) {
    const [, taskIdRaw] = data.split(':')
    const taskId = Number(taskIdRaw)
    if (!Number.isInteger(taskId)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректный ID задачи',
        show_alert: true,
      })
      return
    }

    await beginDeadlineAdjustment(ctx, taskId, {
      requireReason: ctx.user.role !== 'MANAGER',
    })
    return
  }

  if (data.startsWith('task-overdue:')) {
    const [, taskIdRaw] = data.split(':')
    const taskId = Number(taskIdRaw)
    if (!Number.isInteger(taskId)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректный ID задачи',
        show_alert: true,
      })
      return
    }

    await beginDeadlineAdjustment(ctx, taskId, { requireReason: true })
    return
  }

  if (data.startsWith('task-review:')) {
    const [, taskIdRaw, action] = data.split(':')
    const taskId = Number(taskIdRaw)
    if (
      !Number.isInteger(taskId) ||
      !action ||
      !REVIEW_ACTIONS.has(action as 'APPROVE' | 'REJECT')
    ) {
      await ctx.answerCallbackQuery({
        text: 'Некорректный запрос',
        show_alert: true,
      })
      return
    }

    if (ctx.user.role !== 'MANAGER') {
      await ctx.answerCallbackQuery({
        text: 'Только менеджер может подтверждать',
        show_alert: true,
      })
      return
    }

    await handleReviewAction(ctx, taskId, action as 'APPROVE' | 'REJECT')
    return
  }

  if (data === 'attach-cancel') {
    pendingAttachmentUploads.delete(ctx.from.id)
    await ctx.editMessageText('Прикрепление отменено.')
    await ctx.answerCallbackQuery({ text: 'Отменено' })
    return
  }

  if (data.startsWith('attach-page:')) {
    const [, rawPage] = data.split(':')
    const page = Number(rawPage)
    if (!Number.isInteger(page) || page < 0) {
      await ctx.answerCallbackQuery({
        text: 'Некорректная страница',
        show_alert: true,
      })
      return
    }

    await sendAttachmentTaskList(ctx, page, { edit: true })
    await ctx.answerCallbackQuery()
    return
  }

  if (data.startsWith('attach-task:')) {
    const [, rawTaskId] = data.split(':')
    const taskId = Number(rawTaskId)
    if (!Number.isInteger(taskId)) {
      await ctx.answerCallbackQuery({
        text: 'Неверный ID задачи',
        show_alert: true,
      })
      return
    }

    const task = await findTaskForAttachment(taskId)
    if (!task) {
      await ctx.answerCallbackQuery({
        text: 'Задача не найдена',
        show_alert: true,
      })
      return
    }

    if (!canUploadAttachment(task, ctx.user)) {
      await ctx.answerCallbackQuery({
        text: 'Нет прав на эту задачу',
        show_alert: true,
      })
      return
    }

    pendingAttachmentUploads.set(ctx.from.id, timed({ taskId }))
    await ctx.answerCallbackQuery({ text: `Задача #${taskId} выбрана` })
    await ctx.reply(ATTACHMENT_INSTRUCTIONS)
    return
  }

  if (!data.startsWith('assign:')) {
    await ctx.answerCallbackQuery()
    return
  }

  const managerId = ctx.from.id
  const pending = pendingManagerTasks.get(managerId)

  if (!pending) {
    await ctx.answerCallbackQuery({
      text: 'Нет ожидающих задач для назначения.',
      show_alert: true,
    })
    return
  }

  if (data === 'assign:cancel') {
    pendingManagerTasks.delete(managerId)
    await ctx.editMessageText('Создание задачи отменено.')
    await ctx.answerCallbackQuery({ text: 'Отменено' })
    return
  }

  let assigneeId: bigint

  if (data === 'assign:self') {
    assigneeId = BigInt(managerId)
  } else {
    const [, rawId] = data.split(':')
    const parsedId = parseAssigneeId(rawId)
    if (!parsedId) {
      await ctx.answerCallbackQuery({
        text: 'Неверный исполнитель.',
        show_alert: true,
      })
      return
    }
    assigneeId = parsedId
  }

  const assignee = await prisma.user.findUnique({ where: { id: assigneeId } })

  if (!assignee) {
    await ctx.answerCallbackQuery({
      text: 'Выбранный исполнитель не найден.',
      show_alert: true,
    })
    return
  }

  try {
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: pending.title,
          description: pending.description,
          creatorId: BigInt(managerId),
          assigneeId,
          subtasks: pending.subtasks,
          status: 'IN_PROGRESS',
          deadline: pending.deadline,
        },
      })

      await tx.taskAssignment.create({
        data: {
          taskId: created.id,
          userId: assigneeId,
          isLead: true,
        },
      })

      return created
    })

    pendingManagerTasks.delete(managerId)

    await ctx.editMessageText(
      `Задача "${task.title}" назначена ${assignee.name || assignee.id.toString()} (дедлайн ${formatDeadlineForDisplay(pending.deadline)}).`,
    )

    await ctx.answerCallbackQuery({ text: 'Задача назначена' })

    if (assignee.id !== BigInt(managerId)) {
      await bot.api.sendMessage(
        Number(assignee.id),
        `Новая задача от ${ctx.from.first_name || 'Менеджера'}:\n${task.title}\nДедлайн: ${formatDeadlineForDisplay(pending.deadline)}`,
      )
    }
  } catch (error) {
    console.error('Failed to assign task:', error)
    await ctx.answerCallbackQuery({
      text: 'Не удалось создать задачу.',
      show_alert: true,
    })
  }
})

bot.on('message:document', async (ctx) => {
  await handleIncomingAttachment(
    ctx,
    descriptorFromDocument(ctx.message.document),
  )
})

bot.on('message:photo', async (ctx) => {
  await handleIncomingAttachment(ctx, descriptorFromPhoto(ctx.message.photo))
})

bot.on('message:voice', async (ctx) => {
  try {
    const file = await ctx.getFile()
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to download voice: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())

    console.log(`[voice] file_id=${ctx.message.voice.file_id} size=${buffer.length} apiKey=${process.env.NVIDIA_API_KEY?.slice(0, 8) || 'MISSING'}`)
    const text = await transcribeVoice(buffer)
    console.log(`[voice] transcript="${text}"`)
    if (!text) {
      await ctx.reply('Не удалось распознать голосовое сообщение.')
      return
    }

    await ctx.reply(`🎤 Распознано: ${text}`)
  } catch (error) {
    console.error('Voice transcription failed:', error)
    await ctx.reply('Ошибка при распознавании голосового сообщения.')
  }
})

bot.catch((err) => {
  console.error('Bot error:', err)
})
