import { NextResponse } from 'next/server'
import { TaskStatus } from '@prisma/client'

import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'
import { bot } from '@/lib/bot'

const EMPLOYEE_FORBIDDEN_STATUSES = new Set<TaskStatus>(['CLOSED'])
const VALID_STATUS_VALUES = new Set<TaskStatus>(Object.values(TaskStatus))

function canModifyTask(
  task: { creatorId: bigint; assigneeId: bigint | null },
  user: { id: bigint; role: 'EMPLOYEE' | 'MANAGER' }
) {
  if (user.role === 'MANAGER') return true
  if (task.creatorId === user.id) return true
  if (task.assigneeId && task.assigneeId === user.id) return true
  return false
}

function parseDeadline(value: unknown): { ok: true; value: Date | null } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: false, error: 'Deadline field missing' }
  }

  if (value === null) {
    return { ok: true, value: null }
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'Deadline must be a string or null' }
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: 'Deadline must be a valid ISO date string or null' }
  }

  return { ok: true, value: parsed }
}

function normalizeStartOfDay(date: Date) {
  const normalized = new Date(date)
  normalized.setUTCHours(0, 0, 0, 0)
  return normalized
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> | { taskId: string } }
) {
  const resolvedParams = 'then' in context.params ? await context.params : context.params
  const { taskId } = resolvedParams

  const taskIdNumber = Number(taskId)
  if (!Number.isInteger(taskIdNumber) || taskIdNumber <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  const initData = request.headers.get('Authorization')
  if (!initData) {
    return NextResponse.json({ error: 'Authorization header missing' }, { status: 401 })
  }

  const userPayload = validateTelegramWebAppData(initData)
  if (!userPayload) {
    return NextResponse.json({ error: 'Invalid initData' }, { status: 403 })
  }

  const numericUserId = Number(userPayload.user?.id)
  if (!numericUserId || Number.isNaN(numericUserId)) {
    return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
  }

  if (!isWhitelistedTelegramId(numericUserId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let body: { status?: string; deadline?: string | null; assigneeId?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  if (body.status === undefined && body.deadline === undefined && body.assigneeId === undefined) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const telegramUser = await ensureTelegramUser({
    id: numericUserId,
    name: userPayload.user?.first_name,
  })

  const task = await prisma.task.findUnique({
    where: { id: taskIdNumber },
    include: { assignee: true, creator: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (!canModifyTask(task, telegramUser)) {
    return NextResponse.json({ error: 'You are not allowed to modify this task' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}
  let nextStatus: TaskStatus | undefined
  let notifyAssigneeId: bigint | null = null

  if (body.assigneeId !== undefined) {
    if (telegramUser.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Only managers can reassign tasks' }, { status: 403 })
    }

    if (body.assigneeId === null || body.assigneeId === '') {
      updates.assigneeId = null
    } else if (typeof body.assigneeId === 'string') {
      const parsedId = Number(body.assigneeId)
      if (!parsedId || Number.isNaN(parsedId)) {
        return NextResponse.json({ error: 'Invalid assignee ID' }, { status: 400 })
      }

      const assignee = await prisma.user.findUnique({ where: { id: BigInt(parsedId) } })
      if (!assignee) {
        return NextResponse.json({ error: 'Assignee not found' }, { status: 404 })
      }

      updates.assigneeId = assignee.id
      if (!task.assigneeId || task.assigneeId !== assignee.id) {
        notifyAssigneeId = assignee.id
      }
    } else {
      return NextResponse.json({ error: 'Assignee ID must be a string or null' }, { status: 400 })
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_STATUS_VALUES.has(body.status as TaskStatus)) {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
    }

    nextStatus = body.status as TaskStatus

    if (telegramUser.role !== 'MANAGER' && EMPLOYEE_FORBIDDEN_STATUSES.has(nextStatus)) {
      return NextResponse.json({ error: 'Insufficient rights to set this status' }, { status: 403 })
    }

    if (nextStatus !== task.status) {
      updates.status = nextStatus
      updates.statusChangedAt = new Date()
      updates.completedAt = nextStatus === TaskStatus.DONE ? new Date() : null
    }
  }

  if (body.deadline !== undefined) {
    const parsedDeadline = parseDeadline(body.deadline)

    if (!parsedDeadline.ok) {
      return NextResponse.json({ error: parsedDeadline.error }, { status: 400 })
    }

    if (parsedDeadline.value === null) {
      if (telegramUser.role !== 'MANAGER') {
        return NextResponse.json({ error: 'Only managers can remove deadlines' }, { status: 403 })
      }
      updates.deadline = null
    } else {
      const today = normalizeStartOfDay(new Date())
      const normalizedDeadline = normalizeStartOfDay(parsedDeadline.value)

      if (telegramUser.role !== 'MANAGER' && normalizedDeadline < today) {
        return NextResponse.json({ error: 'Deadline cannot be in the past' }, { status: 400 })
      }

      updates.deadline = normalizedDeadline
      updates.lastDeadlineReminderAt = null
      updates.deadlineDayNotifiedAt = null
      updates.overdueNotifiedAt = null
      updates.managerOverdueNotifiedAt = null

      if (task.status === TaskStatus.OVERDUE && !nextStatus) {
        updates.status = TaskStatus.IN_PROGRESS
        updates.statusChangedAt = new Date()
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes detected' }, { status: 400 })
  }

  const updatedTask = await prisma.task.update({
    where: { id: task.id },
    data: updates,
    include: { assignee: true, creator: true },
  })

  if (notifyAssigneeId) {
    const deadlineText = updatedTask.deadline
      ? ` (дедлайн ${updatedTask.deadline.toLocaleDateString('ru-RU')})`
      : ''
    const managerName = telegramUser.name ?? 'менеджера'

    try {
      await bot.api.sendMessage(
        Number(notifyAssigneeId),
        `Вам назначена задача "${updatedTask.title}"${deadlineText} от ${managerName}.`
      )
    } catch (error) {
      console.error('Failed to notify newly assigned user', error)
    }
  }

  return NextResponse.json({
    task: {
      id: updatedTask.id.toString(),
      title: updatedTask.title,
      status: updatedTask.status,
      deadline: updatedTask.deadline ? updatedTask.deadline.toISOString() : null,
      creatorId: updatedTask.creatorId.toString(),
      creatorName: updatedTask.creator?.name ?? null,
      assigneeId: updatedTask.assigneeId?.toString() ?? null,
      assigneeName: updatedTask.assignee?.name ?? null,
      updatedAt: updatedTask.updatedAt.toISOString(),
      completedAt: updatedTask.completedAt?.toISOString() ?? null,
    },
  })
}
