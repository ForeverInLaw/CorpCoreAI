import 'dotenv/config'

import { Prisma, Role as UserRole, TaskStatus } from '@prisma/client'

import { prisma } from '../lib/db'
import { bot } from '../lib/bot'

const MS_IN_DAY = 24 * 60 * 60 * 1000
const TERMINAL_STATUSES = new Set<TaskStatus>(['DONE', 'CLOSED'])

type ReminderDates = {
  lastDailyReminderAt: Date | null
  lastDeadlineReminderAt: Date | null
  deadlineDayNotifiedAt: Date | null
  overdueNotifiedAt: Date | null
  managerOverdueNotifiedAt: Date | null
  statusChangedAt: Date
}

type TaskWithRelations = Prisma.TaskGetPayload<{
  include: { assignee: true; creator: true }
}> &
  ReminderDates

type UpdateData = Partial<{
  lastDailyReminderAt: Date
  lastDeadlineReminderAt: Date
  deadlineDayNotifiedAt: Date
  overdueNotifiedAt: Date
  managerOverdueNotifiedAt: Date
  status: TaskStatus
  statusChangedAt: Date
}>

function startOfUtcDay(date: Date) {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function daysUntil(deadline: Date, todayUtc: Date) {
  const deadlineDay = startOfUtcDay(deadline)
  return Math.floor((deadlineDay.getTime() - todayUtc.getTime()) / MS_IN_DAY)
}

function formatDate(date?: Date | null) {
  if (!date) return '—'
  return date.toLocaleDateString('ru-RU')
}

async function sendMessageSafe(userId: bigint | null | undefined, text: string) {
  if (!userId) return false

  try {
    await bot.api.sendMessage(Number(userId), text)
    return true
  } catch (error) {
    console.error(`Failed to send message to ${userId.toString()}:`, error)
    return false
  }
}

function isTerminal(status: TaskStatus) {
  return TERMINAL_STATUSES.has(status)
}

async function handleDailyReminder(task: TaskWithRelations, todayUtc: Date): Promise<UpdateData> {
  if (task.status !== TaskStatus.IN_PROGRESS || !task.assigneeId) return {}
  if (task.lastDailyReminderAt && task.lastDailyReminderAt >= todayUtc) return {}

  const sent = await sendMessageSafe(
    task.assigneeId,
    `Напоминание: задача "${task.title}" все еще в работе. Дедлайн: ${formatDate(task.deadline)}.`
  )

  return sent ? { lastDailyReminderAt: new Date() } : {}
}

async function handleDeadlineWindow(task: TaskWithRelations, todayUtc: Date): Promise<UpdateData> {
  if (!task.deadline || !task.assigneeId || isTerminal(task.status)) return {}

  const now = new Date()
  const daysDiff = daysUntil(task.deadline, todayUtc)
  const updates: UpdateData = {}

  if (daysDiff === 1 && !task.lastDeadlineReminderAt) {
    const sent = await sendMessageSafe(
      task.assigneeId,
      `До дедлайна по задаче "${task.title}" остался 1 день (до ${formatDate(task.deadline)}).`
    )
    if (sent) updates.lastDeadlineReminderAt = now
  }

  if (daysDiff === 0 && !task.deadlineDayNotifiedAt) {
    const sent = await sendMessageSafe(
      task.assigneeId,
      `Сегодня дедлайн задачи "${task.title}" (${formatDate(task.deadline)}). Не забудьте обновить статус.`
    )
    if (sent) updates.deadlineDayNotifiedAt = now
  }

  return updates
}

async function handleOverdue(task: TaskWithRelations, todayUtc: Date): Promise<UpdateData> {
  if (!task.deadline || !task.assigneeId) return {}

  const daysDiff = daysUntil(task.deadline, todayUtc)
  if (daysDiff >= 0) return {}

  const now = new Date()
  const updates: UpdateData = {}

  if (task.status !== TaskStatus.OVERDUE) {
    updates.status = TaskStatus.OVERDUE
    updates.statusChangedAt = now
  }

  if (!task.overdueNotifiedAt) {
    const sent = await sendMessageSafe(
      task.assigneeId,
      `Задача "${task.title}" просрочена (дедлайн был ${formatDate(task.deadline)}). Укажите новый срок или обновите статус.`
    )
    if (sent) updates.overdueNotifiedAt = now
  }

  const managerId = task.creator?.role === UserRole.MANAGER ? task.creatorId : null
  if (managerId && !task.managerOverdueNotifiedAt) {
    const assigneeName = task.assignee?.name || `ID ${task.assigneeId.toString()}`
    const sent = await sendMessageSafe(
      managerId,
      `Задача "${task.title}" у ${assigneeName} просрочена (дедлайн ${formatDate(task.deadline)}).`
    )
    if (sent) updates.managerOverdueNotifiedAt = now
  }

  return updates
}

async function processTask(task: TaskWithRelations, todayUtc: Date) {
  const updatesList = await Promise.all([
    handleDailyReminder(task, todayUtc),
    handleDeadlineWindow(task, todayUtc),
    handleOverdue(task, todayUtc),
  ])

  const merged = Object.assign({}, ...updatesList) as Prisma.TaskUpdateInput
  if (Object.keys(merged).length === 0) return

  await prisma.task.update({ where: { id: task.id }, data: merged })
}

async function runReminderJob() {
  const todayUtc = startOfUtcDay(new Date())

  const tasks = (await prisma.task.findMany({
    where: {
      status: {
        in: [TaskStatus.IN_PROGRESS, TaskStatus.PAUSED, TaskStatus.OVERDUE],
      },
    },
    include: {
      assignee: true,
      creator: true,
    },
  })) as TaskWithRelations[]

  for (const task of tasks) {
    await processTask(task, todayUtc)
  }
}

void (async () => {
  try {
    await runReminderJob()
  } catch (error) {
    console.error('Reminder job failed', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
})()
