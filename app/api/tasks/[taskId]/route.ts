import { NextResponse } from 'next/server'
import { Prisma, TaskCompletionReviewStatus, TaskStatus } from '@prisma/client'

import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'
import { broadcastTaskNotification, sendTelegramNotification } from '@/lib/bot'
import { logTaskHistory, type TaskHistoryDetails, type TaskHistoryType } from '@/lib/task-history'

const EMPLOYEE_FORBIDDEN_STATUSES = new Set<TaskStatus>(['CLOSED'])
const REVIEW_ACTIONS = new Set(['APPROVE', 'REJECT'] as const)

type ReviewAction = 'APPROVE' | 'REJECT'
type AssignmentPayload = { userId: string; isLead?: boolean }
const VALID_STATUS_VALUES = new Set<TaskStatus>(Object.values(TaskStatus))
const STATUS_LABELS: Record<TaskStatus, string> = {
  IN_PROGRESS: 'в работе',
  DONE: 'готово',
  PAUSED: 'на паузе',
  OVERDUE: 'просрочена',
  CLOSED: 'закрыта',
}

function isTeamMember(
  assignments: { userId: bigint }[] | undefined,
  userId: bigint
) {
  return Boolean(assignments?.some((assignment) => assignment.userId === userId))
}

function canModifyTask(
  task: { creatorId: bigint; assigneeId: bigint | null; assignments?: { userId: bigint }[] },
  user: { id: bigint; role: 'EMPLOYEE' | 'MANAGER' }
) {
  if (user.role === 'MANAGER') return true
  if (task.creatorId === user.id) return true
  if (task.assigneeId && task.assigneeId === user.id) return true
  if (isTeamMember(task.assignments, user.id)) return true
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

  const userId = userPayload.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
  }

  if (!isWhitelistedTelegramId(String(userId))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let body: {
    status?: string
    deadline?: string | null
    assigneeId?: string | null
    assignments?: AssignmentPayload[]
    tagIds?: number[]
    projectIds?: number[]
    reviewAction?: ReviewAction
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  if (
    body.status === undefined &&
    body.deadline === undefined &&
    body.assigneeId === undefined &&
    body.assignments === undefined &&
    body.tagIds === undefined &&
    body.projectIds === undefined &&
    body.reviewAction === undefined
  ) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const telegramUser = await ensureTelegramUser({
    id: String(userId),
    name: userPayload.user?.first_name,
  })

  const task = await prisma.task.findUnique({
    where: { id: taskIdNumber },
    include: {
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
    },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (!canModifyTask(task, telegramUser)) {
    return NextResponse.json({ error: 'You are not allowed to modify this task' }, { status: 403 })
  }

  const updates: Prisma.TaskUpdateInput = {}
  let nextStatus: TaskStatus | undefined
  let notifyAssigneeId: bigint | null = null
  const historyEntries: { type: TaskHistoryType; details?: TaskHistoryDetails }[] = []
  const previousDeadlineIso = task.deadline ? task.deadline.toISOString() : null
  let normalizedAssignments: { userId: bigint; isLead: boolean; name: string | null }[] | undefined
  let normalizedTagIds: number[] | undefined
  let normalizedProjectIds: number[] | undefined
  let reviewAction: ReviewAction | undefined
  const teamHistoryBefore = task.assignments.map((assignment) => ({
    userId: assignment.userId.toString(),
    name: assignment.user?.name ?? `ID ${assignment.userId.toString()}`,
    isLead: assignment.isLead,
  }))
  const previousTagSnapshot = task.tags.map((entry) => entry.tagId)
  const previousProjectSnapshot = task.projects.map((entry) => entry.projectId)

  if (body.assignments !== undefined) {
    if (telegramUser.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Only managers can edit team' }, { status: 403 })
    }

    if (!Array.isArray(body.assignments)) {
      return NextResponse.json({ error: 'Assignments must be an array' }, { status: 400 })
    }

    const seen = new Set<string>()
    const parsedAssignments: { userId: bigint; isLead: boolean }[] = []
    for (const assignment of body.assignments) {
      if (!assignment || typeof assignment !== 'object' || typeof assignment.userId !== 'string') {
        return NextResponse.json({ error: 'Each assignment must include userId string' }, { status: 400 })
      }

      const numericId = Number(assignment.userId)
      if (!Number.isInteger(numericId) || numericId <= 0) {
        return NextResponse.json({ error: 'Assignment userId must be a positive integer string' }, { status: 400 })
      }

      const bigintId = BigInt(numericId)
      const key = bigintId.toString()
      if (seen.has(key)) continue
      seen.add(key)
      parsedAssignments.push({ userId: bigintId, isLead: Boolean(assignment.isLead) })
    }

    if (parsedAssignments.length > 0 && !parsedAssignments.some((entry) => entry.isLead)) {
      parsedAssignments[0].isLead = true
    }

    if (parsedAssignments.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: parsedAssignments.map((entry) => entry.userId) } },
        select: { id: true, name: true },
      })
      if (users.length !== parsedAssignments.length) {
        return NextResponse.json({ error: 'One or more team members not found' }, { status: 404 })
      }
      const userNameMap = new Map(users.map((user) => [user.id.toString(), user.name ?? null]))
      normalizedAssignments = parsedAssignments.map((entry) => ({
        userId: entry.userId,
        isLead: entry.isLead,
        name: userNameMap.get(entry.userId.toString()) ?? null,
      }))
    } else {
      normalizedAssignments = []
    }
  }

  if (body.tagIds !== undefined) {
    if (telegramUser.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Only managers can update tags' }, { status: 403 })
    }
    if (!Array.isArray(body.tagIds)) {
      return NextResponse.json({ error: 'tagIds must be an array' }, { status: 400 })
    }
    const parsed = body.tagIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    if (parsed.length !== body.tagIds.length) {
      return NextResponse.json({ error: 'All tagIds must be positive integers' }, { status: 400 })
    }
    normalizedTagIds = Array.from(new Set(parsed))
    if (normalizedTagIds.length > 0) {
      const tags = await prisma.tag.findMany({ where: { id: { in: normalizedTagIds } }, select: { id: true } })
      if (tags.length !== normalizedTagIds.length) {
        return NextResponse.json({ error: 'One or more tags not found' }, { status: 404 })
      }
    }
  }

  if (body.projectIds !== undefined) {
    if (telegramUser.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Only managers can update projects' }, { status: 403 })
    }
    if (!Array.isArray(body.projectIds)) {
      return NextResponse.json({ error: 'projectIds must be an array' }, { status: 400 })
    }
    const parsed = body.projectIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    if (parsed.length !== body.projectIds.length) {
      return NextResponse.json({ error: 'All projectIds must be positive integers' }, { status: 400 })
    }
    normalizedProjectIds = Array.from(new Set(parsed))
    if (normalizedProjectIds.length > 0) {
      const projects = await prisma.project.findMany({ where: { id: { in: normalizedProjectIds } }, select: { id: true } })
      if (projects.length !== normalizedProjectIds.length) {
        return NextResponse.json({ error: 'One or more projects not found' }, { status: 404 })
      }
    }
  }

  if (body.reviewAction !== undefined) {
    if (telegramUser.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Only managers can review tasks' }, { status: 403 })
    }
    if (!REVIEW_ACTIONS.has(body.reviewAction)) {
      return NextResponse.json({ error: 'Invalid review action' }, { status: 400 })
    }
    reviewAction = body.reviewAction
  }

  let assigneeUpdateRequested = body.assigneeId !== undefined
  let effectiveAssigneePayload = body.assigneeId

  if (normalizedAssignments !== undefined) {
    assigneeUpdateRequested = true
    const leadCandidate = normalizedAssignments.find((entry) => entry.isLead)?.userId ?? normalizedAssignments[0]?.userId ?? null
    effectiveAssigneePayload = leadCandidate ? leadCandidate.toString() : null
  }

  if (assigneeUpdateRequested) {
    if (telegramUser.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Only managers can reassign tasks' }, { status: 403 })
    }

    if (effectiveAssigneePayload === null || effectiveAssigneePayload === '') {
      updates.assignee = { disconnect: true }
      if (task.assigneeId) {
        historyEntries.push({
          type: 'ASSIGNEE_CHANGE',
          details: {
            fromId: task.assigneeId.toString(),
            fromName: task.assignee?.name ?? null,
            toId: null,
            toName: null,
          },
        })
      }
    } else if (typeof effectiveAssigneePayload === 'string') {
      const parsedId = Number(effectiveAssigneePayload)
      if (!parsedId || Number.isNaN(parsedId)) {
        return NextResponse.json({ error: 'Invalid assignee ID' }, { status: 400 })
      }

      const assignee = await prisma.user.findUnique({ where: { id: BigInt(parsedId) } })
      if (!assignee) {
        return NextResponse.json({ error: 'Assignee not found' }, { status: 404 })
      }

      updates.assignee = { connect: { id: assignee.id } }
      if (!task.assigneeId || task.assigneeId !== assignee.id) {
        notifyAssigneeId = assignee.id
        historyEntries.push({
          type: 'ASSIGNEE_CHANGE',
          details: {
            fromId: task.assigneeId ? task.assigneeId.toString() : null,
            fromName: task.assignee?.name ?? null,
            toId: assignee.id.toString(),
            toName: assignee.name ?? null,
          },
        })
      }
    } else {
      return NextResponse.json({ error: 'Assignee ID must be a string or null' }, { status: 400 })
    }
  }

  const now = new Date()

  if (reviewAction) {
    if (task.status !== TaskStatus.DONE) {
      return NextResponse.json({ error: 'Only completed tasks can be reviewed' }, { status: 400 })
    }

    if (task.completionReviewStatus !== TaskCompletionReviewStatus.PENDING) {
      return NextResponse.json({ error: 'Task is not awaiting review' }, { status: 400 })
    }

    if (reviewAction === 'APPROVE') {
      updates.status = TaskStatus.CLOSED
      nextStatus = TaskStatus.CLOSED
      updates.completionReviewStatus = TaskCompletionReviewStatus.APPROVED
      updates.completionReviewedAt = now
      updates.completionReviewedBy = { connect: { id: telegramUser.id } }
      if (!task.completionRequestedAt) {
        updates.completionRequestedAt = task.completedAt ?? now
      }
    } else {
      updates.status = TaskStatus.IN_PROGRESS
      nextStatus = TaskStatus.IN_PROGRESS
      updates.completedAt = null
      updates.completionReviewStatus = TaskCompletionReviewStatus.REJECTED
      updates.completionReviewedAt = now
      updates.completionReviewedBy = { connect: { id: telegramUser.id } }
    }

    historyEntries.push({
      type: 'REVIEW_STATUS_CHANGE',
      details: {
        action: reviewAction,
        from: task.completionReviewStatus,
        to: updates.completionReviewStatus,
      },
    })
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
      updates.statusChangedAt = now
      updates.completedAt = nextStatus === TaskStatus.DONE ? now : updates.completedAt ?? (nextStatus === TaskStatus.CLOSED ? task.completedAt : null)
      historyEntries.push({
        type: 'STATUS_CHANGE',
        details: {
          from: task.status,
          to: nextStatus,
        },
      })
    }

    if (nextStatus === TaskStatus.DONE && !reviewAction) {
      if (telegramUser.role === 'MANAGER') {
        updates.completionReviewStatus = TaskCompletionReviewStatus.APPROVED
        updates.completionReviewedAt = now
        updates.completionReviewedBy = { connect: { id: telegramUser.id } }
        updates.completionRequestedAt = task.completionRequestedAt ?? now
        historyEntries.push({
          type: 'REVIEW_STATUS_CHANGE',
          details: {
            from: task.completionReviewStatus,
            to: TaskCompletionReviewStatus.APPROVED,
            reason: 'AUTO_APPROVED_BY_MANAGER',
          },
        })
      } else {
        updates.completionReviewStatus = TaskCompletionReviewStatus.PENDING
        updates.completionRequestedAt = now
        updates.completionReviewedAt = null
        updates.completionReviewedBy = { disconnect: true }
        historyEntries.push({
          type: 'REVIEW_STATUS_CHANGE',
          details: {
            from: task.completionReviewStatus,
            to: TaskCompletionReviewStatus.PENDING,
            reason: 'REQUESTED_BY_ASSIGNEE',
          },
        })
      }
    } else if (nextStatus && nextStatus !== TaskStatus.DONE && !reviewAction) {
      updates.completionReviewStatus = TaskCompletionReviewStatus.NOT_REQUESTED
      updates.completionRequestedAt = null
      updates.completionReviewedAt = null
      updates.completionReviewedBy = { disconnect: true }
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
      if (previousDeadlineIso) {
        historyEntries.push({
          type: 'DEADLINE_CHANGE',
          details: {
            from: previousDeadlineIso,
            to: null,
          },
        })
      }
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

      const newDeadlineIso = normalizedDeadline.toISOString()
      if (previousDeadlineIso !== newDeadlineIso) {
        historyEntries.push({
          type: 'DEADLINE_CHANGE',
          details: {
            from: previousDeadlineIso,
            to: newDeadlineIso,
          },
        })
      }

      if (task.status === TaskStatus.OVERDUE && !nextStatus) {
        updates.status = TaskStatus.IN_PROGRESS
        updates.statusChangedAt = new Date()
        historyEntries.push({
          type: 'STATUS_CHANGE',
          details: {
            from: task.status,
            to: TaskStatus.IN_PROGRESS,
          },
        })
      }
    }
  }

  if (
    Object.keys(updates).length === 0 &&
    normalizedAssignments === undefined &&
    normalizedTagIds === undefined &&
    normalizedProjectIds === undefined
  ) {
    return NextResponse.json({ error: 'No changes detected' }, { status: 400 })
  }

  const updatedTask = await prisma.$transaction(async (tx) => {
    const freshTask = await tx.task.findUnique({ where: { id: task.id }, select: { status: true } })
    if (!freshTask) {
      throw new Error('Task disappeared during update')
    }
    if (freshTask.status !== task.status) {
      throw new Error('Task was modified by another request')
    }

    let nextTeamSnapshot = teamHistoryBefore
    if (normalizedAssignments !== undefined) {
      if (normalizedAssignments.length === 0) {
        await tx.taskAssignment.deleteMany({ where: { taskId: task.id } })
        nextTeamSnapshot = []
      } else {
        const keepIds = normalizedAssignments.map((entry) => entry.userId)
        await tx.taskAssignment.deleteMany({
          where: {
            taskId: task.id,
            userId: { notIn: keepIds },
          },
        })
        await Promise.all(
          normalizedAssignments.map((entry) =>
            tx.taskAssignment.upsert({
              where: { taskId_userId: { taskId: task.id, userId: entry.userId } },
              update: { isLead: entry.isLead },
              create: { taskId: task.id, userId: entry.userId, isLead: entry.isLead },
            })
          )
        )
        nextTeamSnapshot = normalizedAssignments.map((entry) => ({
          userId: entry.userId.toString(),
          name: entry.name ?? `ID ${entry.userId.toString()}`,
          isLead: entry.isLead,
        }))
      }

      const teamChanged =
        JSON.stringify(teamHistoryBefore) !== JSON.stringify(nextTeamSnapshot)

      if (teamChanged) {
        historyEntries.push({
          type: 'TEAM_CHANGE',
          details: {
            from: teamHistoryBefore,
            to: nextTeamSnapshot,
          },
        })
      }
    }

    if (normalizedTagIds !== undefined) {
      if (normalizedTagIds.length === 0) {
        await tx.taskTag.deleteMany({ where: { taskId: task.id } })
      } else {
        await tx.taskTag.deleteMany({
          where: {
            taskId: task.id,
            tagId: { notIn: normalizedTagIds },
          },
        })
        await tx.taskTag.createMany({
          data: normalizedTagIds.map((tagId) => ({ taskId: task.id, tagId })),
          skipDuplicates: true,
        })
      }

      if (JSON.stringify(previousTagSnapshot) !== JSON.stringify(normalizedTagIds)) {
        historyEntries.push({
          type: 'TAG_CHANGE',
          details: {
            from: previousTagSnapshot,
            to: normalizedTagIds,
          },
        })
      }
    }

    if (normalizedProjectIds !== undefined) {
      if (normalizedProjectIds.length === 0) {
        await tx.taskProject.deleteMany({ where: { taskId: task.id } })
      } else {
        await tx.taskProject.deleteMany({
          where: {
            taskId: task.id,
            projectId: { notIn: normalizedProjectIds },
          },
        })
        await tx.taskProject.createMany({
          data: normalizedProjectIds.map((projectId) => ({ taskId: task.id, projectId })),
          skipDuplicates: true,
        })
      }

      if (JSON.stringify(previousProjectSnapshot) !== JSON.stringify(normalizedProjectIds)) {
        historyEntries.push({
          type: 'PROJECT_CHANGE',
          details: {
            from: previousProjectSnapshot,
            to: normalizedProjectIds,
          },
        })
      }
    }

    return tx.task.update({
      where: { id: task.id },
      data: updates,
      include: {
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
      },
    })
  })

  if (historyEntries.length > 0) {
    await Promise.all(
      historyEntries.map((entry) =>
        logTaskHistory({
          taskId: updatedTask.id,
          actorId: telegramUser.id,
          type: entry.type,
          details: entry.details,
        })
      )
    )
  }

    if (notifyAssigneeId) {
        const deadlineText = updatedTask.deadline
            ? ` (дедлайн ${updatedTask.deadline.toLocaleDateString('ru-RU')})`
            : ''
        const managerName = telegramUser.name ?? 'менеджера'

        await sendTelegramNotification(
            notifyAssigneeId,
            `Вам назначена задача "${updatedTask.title}"${deadlineText} от ${managerName}.`
        )
    }

    // Team changes notifications
    if (normalizedAssignments !== undefined) {
        const oldUserIds = new Set(teamHistoryBefore.map(t => t.userId))
        const newUserIds = new Set(normalizedAssignments.map(t => t.userId.toString()))

        const addedIds = normalizedAssignments
            .filter(entry => !oldUserIds.has(entry.userId.toString()))
            .map(entry => entry.userId)

        const removedIds = teamHistoryBefore
            .filter(entry => !newUserIds.has(entry.userId))
            .map(entry => BigInt(entry.userId))

        // Notify added members
        if (addedIds.length > 0) {
            await Promise.all(addedIds.map(id => 
                sendTelegramNotification(
                    id,
                    `Вы добавлены в команду задачи "${updatedTask.title}".`
                )
            ))
        }

        // Notify removed members
        if (removedIds.length > 0) {
            await Promise.all(removedIds.map(id => 
                sendTelegramNotification(
                    id,
                    `Вы исключены из команды задачи "${updatedTask.title}".`
                )
            ))
        }

        // Broadcast to others if team changed
        if (addedIds.length > 0 || removedIds.length > 0) {
            const changes: string[] = []
            if (addedIds.length > 0) changes.push(`добавлены: ${addedIds.length} чел.`)
            if (removedIds.length > 0) changes.push(`удалены: ${removedIds.length} чел.`)
            
            const teamMsg = `Состав команды задачи "${updatedTask.title}" обновлён (${changes.join(', ')}).`
            
            // Notify everyone else (excluding the ones just added/removed/actor)
            const excludeIds = new Set([...addedIds, ...removedIds, telegramUser.id])
            
            // We use broadcastTaskNotification but need to pass excludeUserId logic manually 
            // or call sendTelegramNotification for calculated recipients.
            // Since broadcastTaskNotification only accepts ONE excludeUserId, 
            // let's implement manual broadcast here to support multiple exclusions.
            
            const recipients = new Set<bigint>()
            if (updatedTask.creatorId) recipients.add(updatedTask.creatorId)
            if (updatedTask.assigneeId) recipients.add(updatedTask.assigneeId)
            updatedTask.assignments.forEach(a => recipients.add(a.userId))
            
            excludeIds.forEach(id => recipients.delete(id))
            
            await Promise.all(
                Array.from(recipients).map(id => sendTelegramNotification(id, teamMsg))
            )
        }
    }

    const statusChanged = nextStatus && nextStatus !== task.status

    if (statusChanged && nextStatus) {
        const actorName = telegramUser.name ?? `ID ${telegramUser.id.toString()}`
        const statusLabel = STATUS_LABELS[nextStatus] ?? nextStatus
        const baseText = `Статус задачи "${updatedTask.title}" изменён на «${statusLabel}». Инициатор: ${actorName}.`

        await broadcastTaskNotification(updatedTask, baseText, telegramUser.id)
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
