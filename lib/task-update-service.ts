import { Prisma, TaskCompletionReviewStatus, TaskStatus } from '@prisma/client'
import type { TaskHistoryDetails, TaskHistoryType } from '@/lib/task-history'
import { logTaskHistory } from '@/lib/task-history'
import { broadcastTaskNotification, sendTelegramNotification } from '@/lib/bot'
import { prisma } from '@/lib/db'

type ReviewAction = 'APPROVE' | 'REJECT'

const EMPLOYEE_FORBIDDEN_STATUSES = new Set<TaskStatus>(['CLOSED'])
const REVIEW_ACTIONS = new Set<ReviewAction>(['APPROVE', 'REJECT'])
const VALID_STATUS_VALUES = new Set<TaskStatus>(Object.values(TaskStatus))
const STATUS_LABELS: Record<TaskStatus, string> = {
  IN_PROGRESS: 'в работе',
  DONE: 'готово',
  PAUSED: 'на паузе',
  OVERDUE: 'просрочена',
  CLOSED: 'закрыта',
}

function normalizeStartOfDay(date: Date) {
  const normalized = new Date(date)
  normalized.setUTCHours(0, 0, 0, 0)
  return normalized
}

class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message)
  }
}

interface TaskWithJoins {
  id: number
  title: string
  creatorId: bigint
  assigneeId: bigint | null
  status: TaskStatus
  deadline: Date | null
  completedAt: Date | null
  completionReviewStatus: TaskCompletionReviewStatus | null
  completionRequestedAt: Date | null
  completionReviewedAt: Date | null
  updatedAt: Date
  statusChangedAt: Date | null
  lastDeadlineReminderAt: Date | null
  deadlineDayNotifiedAt: Date | null
  overdueNotifiedAt: Date | null
  managerOverdueNotifiedAt: Date | null
  assignee: { id: bigint; name: string | null } | null
  creator: { id: bigint; name: string | null } | null
  assignments: {
    userId: bigint
    isLead: boolean
    user: { id: bigint; name: string | null } | null
  }[]
  tags: { tagId: number; tag: Record<string, unknown> }[]
  projects: { projectId: number; project: Record<string, unknown> }[]
}

interface UserInfo {
  id: bigint
  role: 'EMPLOYEE' | 'MANAGER'
  name: string | null
}

interface NormalizedAssignment {
  userId: bigint
  isLead: boolean
  name: string | null
}

interface HistoryEntry {
  type: TaskHistoryType
  details?: TaskHistoryDetails
}

interface TaskResponse {
  id: string
  title: string
  status: TaskStatus
  deadline: string | null
  creatorId: string
  creatorName: string | null
  assigneeId: string | null
  assigneeName: string | null
  updatedAt: string
  completedAt: string | null
}

export interface ServiceResult {
  task?: TaskResponse
  error?: string
  status?: number
}

export class TaskUpdateService {
  private readonly updates: Prisma.TaskUpdateInput = {}
  private nextStatus?: TaskStatus
  private notifyAssigneeId: bigint | null = null
  private readonly historyEntries: HistoryEntry[] = []
  private normalizedAssignments?: NormalizedAssignment[]
  private normalizedTagIds?: number[]
  private normalizedProjectIds?: number[]
  private reviewAction?: ReviewAction
  private readonly now = new Date()
  private readonly previousDeadlineIso: string | null
  private readonly teamBefore: { userId: string; name: string; isLead: boolean }[]
  private readonly tagsBefore: number[]
  private readonly projectsBefore: number[]

  private constructor(
    private readonly user: UserInfo,
    private readonly task: TaskWithJoins,
    private readonly body: Record<string, unknown>,
  ) {
    this.previousDeadlineIso = task.deadline
      ? task.deadline.toISOString()
      : null
    this.teamBefore = task.assignments.map((a) => ({
      userId: a.userId.toString(),
      name: a.user?.name ?? `ID ${a.userId.toString()}`,
      isLead: a.isLead,
    }))
    this.tagsBefore = task.tags.map((t) => t.tagId)
    this.projectsBefore = task.projects.map((p) => p.projectId)
  }

  static async execute(
    user: UserInfo,
    task: TaskWithJoins,
    body: Record<string, unknown>,
  ): Promise<ServiceResult> {
    return new TaskUpdateService(user, task, body).run()
  }

  private async run(): Promise<ServiceResult> {
    try {
      this.requireUpdatableFields()
      await this.processAssignments()
      await this.processTagIds()
      await this.processProjectIds()
      this.processReviewAction()
      await this.processAssigneeUpdate()
      this.executeReview()
      this.processStatus()
      this.processDeadline()
      return await this.commit()
    } catch (err) {
      if (err instanceof ServiceError) {
        return { error: err.message, status: err.status }
      }
      throw err
    }
  }

  private requireUpdatableFields() {
    const { status, deadline, assigneeId, assignments, tagIds, projectIds, reviewAction } =
      this.body
    if (
      status === undefined &&
      deadline === undefined &&
      assigneeId === undefined &&
      assignments === undefined &&
      tagIds === undefined &&
      projectIds === undefined &&
      reviewAction === undefined
    ) {
      throw new ServiceError('No updatable fields provided')
    }
  }

  private async processAssignments() {
    const raw = this.body.assignments
    if (raw === undefined) return

    if (this.user.role !== 'MANAGER') {
      throw new ServiceError('Only managers can edit team', 403)
    }
    if (!Array.isArray(raw)) {
      throw new ServiceError('Assignments must be an array')
    }

    const seen = new Set<string>()
    const parsed: { userId: bigint; isLead: boolean }[] = []
    for (const item of raw) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as Record<string, unknown>).userId !== 'string'
      ) {
        throw new ServiceError('Each assignment must include userId string')
      }
      const entry = item as Record<string, unknown>
      const numericId = Number(entry.userId)
      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new ServiceError(
          'Assignment userId must be a positive integer string',
        )
      }
      const bigintId = BigInt(numericId)
      const key = bigintId.toString()
      if (seen.has(key)) continue
      seen.add(key)
      parsed.push({ userId: bigintId, isLead: Boolean(entry.isLead) })
    }

    if (parsed.length > 0 && !parsed.some((e) => e.isLead)) {
      parsed[0].isLead = true
    }

    if (parsed.length === 0) {
      this.normalizedAssignments = []
      return
    }

    const users = await prisma.user.findMany({
      where: { id: { in: parsed.map((e) => e.userId) } },
      select: { id: true, name: true },
    })
    if (users.length !== parsed.length) {
      throw new ServiceError('One or more team members not found', 404)
    }
    const nameMap = new Map(
      users.map((u) => [u.id.toString(), u.name ?? null]),
    )
    this.normalizedAssignments = parsed.map((e) => ({
      userId: e.userId,
      isLead: e.isLead,
      name: nameMap.get(e.userId.toString()) ?? null,
    }))
  }

  private async processTagIds() {
    const raw = this.body.tagIds
    if (raw === undefined) return

    if (this.user.role !== 'MANAGER') {
      throw new ServiceError('Only managers can update tags', 403)
    }
    if (!Array.isArray(raw)) {
      throw new ServiceError('tagIds must be an array')
    }

    const parsed = raw
      .map(Number)
      .filter((v) => Number.isInteger(v) && v > 0)
    if (parsed.length !== raw.length) {
      throw new ServiceError('All tagIds must be positive integers')
    }

    this.normalizedTagIds = Array.from(new Set(parsed))
    if (this.normalizedTagIds.length === 0) return

    const tags = await prisma.tag.findMany({
      where: { id: { in: this.normalizedTagIds } },
      select: { id: true },
    })
    if (tags.length !== this.normalizedTagIds.length) {
      throw new ServiceError('One or more tags not found', 404)
    }
  }

  private async processProjectIds() {
    const raw = this.body.projectIds
    if (raw === undefined) return

    if (this.user.role !== 'MANAGER') {
      throw new ServiceError('Only managers can update projects', 403)
    }
    if (!Array.isArray(raw)) {
      throw new ServiceError('projectIds must be an array')
    }

    const parsed = raw
      .map(Number)
      .filter((v) => Number.isInteger(v) && v > 0)
    if (parsed.length !== raw.length) {
      throw new ServiceError('All projectIds must be positive integers')
    }

    this.normalizedProjectIds = Array.from(new Set(parsed))
    if (this.normalizedProjectIds.length === 0) return

    const projects = await prisma.project.findMany({
      where: { id: { in: this.normalizedProjectIds } },
      select: { id: true },
    })
    if (projects.length !== this.normalizedProjectIds.length) {
      throw new ServiceError('One or more projects not found', 404)
    }
  }

  private processReviewAction() {
    const raw = this.body.reviewAction
    if (raw === undefined) return

    if (this.user.role !== 'MANAGER') {
      throw new ServiceError('Only managers can review tasks', 403)
    }
    if (!REVIEW_ACTIONS.has(raw as ReviewAction)) {
      throw new ServiceError('Invalid review action')
    }
    this.reviewAction = raw as ReviewAction
  }

  private async processAssigneeUpdate() {
    let updateRequested = this.body.assigneeId !== undefined
    let effectivePayload = this.body.assigneeId as string | null | undefined

    if (this.normalizedAssignments !== undefined) {
      updateRequested = true
      const lead =
        this.normalizedAssignments.find((e) => e.isLead)?.userId ??
        this.normalizedAssignments[0]?.userId ??
        null
      effectivePayload = lead ? lead.toString() : null
    }

    if (!updateRequested) return

    if (this.user.role !== 'MANAGER') {
      throw new ServiceError('Only managers can reassign tasks', 403)
    }

    if (effectivePayload === null || effectivePayload === '') {
      this.updates.assignee = { disconnect: true }
      if (this.task.assigneeId) {
        this.historyEntries.push({
          type: 'ASSIGNEE_CHANGE',
          details: {
            fromId: this.task.assigneeId.toString(),
            fromName: this.task.assignee?.name ?? null,
            toId: null,
            toName: null,
          },
        })
      }
      return
    }

    const parsedId = Number(effectivePayload)
    if (!parsedId || Number.isNaN(parsedId)) {
      throw new ServiceError('Invalid assignee ID')
    }

    const assignee = await prisma.user.findUnique({
      where: { id: BigInt(parsedId) },
    })
    if (!assignee) {
      throw new ServiceError('Assignee not found', 404)
    }

    this.updates.assignee = { connect: { id: assignee.id } }
    if (!this.task.assigneeId || this.task.assigneeId !== assignee.id) {
      this.notifyAssigneeId = assignee.id
      this.historyEntries.push({
        type: 'ASSIGNEE_CHANGE',
        details: {
          fromId: this.task.assigneeId
            ? this.task.assigneeId.toString()
            : null,
          fromName: this.task.assignee?.name ?? null,
          toId: assignee.id.toString(),
          toName: assignee.name ?? null,
        },
      })
    }
  }

  private executeReview() {
    if (!this.reviewAction) return

    if (this.task.status !== TaskStatus.DONE) {
      throw new ServiceError('Only completed tasks can be reviewed')
    }
    if (
      this.task.completionReviewStatus !== TaskCompletionReviewStatus.PENDING
    ) {
      throw new ServiceError('Task is not awaiting review')
    }

    if (this.reviewAction === 'APPROVE') {
      this.updates.status = TaskStatus.CLOSED
      this.nextStatus = TaskStatus.CLOSED
      this.updates.completionReviewStatus = TaskCompletionReviewStatus.APPROVED
      this.updates.completionReviewedAt = this.now
      this.updates.completionReviewedBy = { connect: { id: this.user.id } }
      if (!this.task.completionRequestedAt) {
        this.updates.completionRequestedAt =
          this.task.completedAt ?? this.now
      }
    } else {
      this.updates.status = TaskStatus.IN_PROGRESS
      this.nextStatus = TaskStatus.IN_PROGRESS
      this.updates.completedAt = null
      this.updates.completionReviewStatus = TaskCompletionReviewStatus.REJECTED
      this.updates.completionReviewedAt = this.now
      this.updates.completionReviewedBy = { connect: { id: this.user.id } }
    }

    this.historyEntries.push({
      type: 'REVIEW_STATUS_CHANGE',
      details: {
        action: this.reviewAction,
        from: this.task.completionReviewStatus,
        to: this.updates.completionReviewStatus as TaskCompletionReviewStatus,
      },
    })
  }

  private processStatus() {
    const raw = this.body.status
    if (raw === undefined) return

    if (
      typeof raw !== 'string' ||
      !VALID_STATUS_VALUES.has(raw as TaskStatus)
    ) {
      throw new ServiceError('Invalid status value')
    }

    this.nextStatus = raw as TaskStatus

    if (
      this.user.role !== 'MANAGER' &&
      EMPLOYEE_FORBIDDEN_STATUSES.has(this.nextStatus)
    ) {
      throw new ServiceError('Insufficient rights to set this status', 403)
    }

    if (this.nextStatus !== this.task.status) {
      this.updates.status = this.nextStatus
      this.updates.statusChangedAt = this.now
      if (this.nextStatus === TaskStatus.DONE) {
        this.updates.completedAt = this.now
      } else {
        this.updates.completedAt ??=
          this.nextStatus === TaskStatus.CLOSED ? this.task.completedAt : null
      }
      this.historyEntries.push({
        type: 'STATUS_CHANGE',
        details: { from: this.task.status, to: this.nextStatus },
      })
    }

    if (this.nextStatus === TaskStatus.DONE && !this.reviewAction) {
      if (this.user.role === 'MANAGER') {
        this.updates.completionReviewStatus =
          TaskCompletionReviewStatus.APPROVED
        this.updates.completionReviewedAt = this.now
        this.updates.completionReviewedBy = { connect: { id: this.user.id } }
        this.updates.completionRequestedAt =
          this.task.completionRequestedAt ?? this.now
        this.historyEntries.push({
          type: 'REVIEW_STATUS_CHANGE',
          details: {
            from: this.task.completionReviewStatus,
            to: TaskCompletionReviewStatus.APPROVED,
            reason: 'AUTO_APPROVED_BY_MANAGER',
          },
        })
      } else {
        this.updates.completionReviewStatus =
          TaskCompletionReviewStatus.PENDING
        this.updates.completionRequestedAt = this.now
        this.updates.completionReviewedAt = null
        this.updates.completionReviewedBy = { disconnect: true }
        this.historyEntries.push({
          type: 'REVIEW_STATUS_CHANGE',
          details: {
            from: this.task.completionReviewStatus,
            to: TaskCompletionReviewStatus.PENDING,
            reason: 'REQUESTED_BY_ASSIGNEE',
          },
        })
      }
    } else if (
      this.nextStatus &&
      this.nextStatus !== TaskStatus.DONE &&
      !this.reviewAction
    ) {
      this.updates.completionReviewStatus =
        TaskCompletionReviewStatus.NOT_REQUESTED
      this.updates.completionRequestedAt = null
      this.updates.completionReviewedAt = null
      this.updates.completionReviewedBy = { disconnect: true }
    }
  }

  private processDeadline() {
    const raw = this.body.deadline
    if (raw === undefined) return

    if (raw === null) {
      if (this.user.role !== 'MANAGER') {
        throw new ServiceError('Only managers can remove deadlines', 403)
      }
      this.updates.deadline = null
      if (this.previousDeadlineIso) {
        this.historyEntries.push({
          type: 'DEADLINE_CHANGE',
          details: { from: this.previousDeadlineIso, to: null },
        })
      }
      return
    }

    if (typeof raw !== 'string') {
      throw new ServiceError('Deadline must be a string or null')
    }
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
      throw new ServiceError('Deadline must be a valid ISO date string or null')
    }

    const today = normalizeStartOfDay(new Date())
    const normalized = normalizeStartOfDay(parsed)

    if (this.user.role !== 'MANAGER' && normalized < today) {
      throw new ServiceError('Deadline cannot be in the past')
    }

    this.updates.deadline = normalized
    this.updates.lastDeadlineReminderAt = null
    this.updates.deadlineDayNotifiedAt = null
    this.updates.overdueNotifiedAt = null
    this.updates.managerOverdueNotifiedAt = null

    const iso = normalized.toISOString()
    if (this.previousDeadlineIso !== iso) {
      this.historyEntries.push({
        type: 'DEADLINE_CHANGE',
        details: { from: this.previousDeadlineIso, to: iso },
      })
    }

    if (this.task.status === TaskStatus.OVERDUE && !this.nextStatus) {
      this.updates.status = TaskStatus.IN_PROGRESS
      this.updates.statusChangedAt = new Date()
      this.historyEntries.push({
        type: 'STATUS_CHANGE',
        details: { from: this.task.status, to: TaskStatus.IN_PROGRESS },
      })
    }
  }

  private async commit(): Promise<ServiceResult> {
    const updatedTask = await prisma.$transaction(async (tx) => {
      const fresh = await tx.task.findUnique({
        where: { id: this.task.id },
        select: { status: true },
      })
      if (!fresh) throw new ServiceError('Task disappeared during update', 500)
      if (fresh.status !== this.task.status) {
        throw new ServiceError('Task was modified by another request', 409)
      }

      if (this.normalizedAssignments !== undefined) {
        await this.applyTeamChanges(tx)
      }
      if (this.normalizedTagIds !== undefined) {
        await this.applyTagChanges(tx)
      }
      if (this.normalizedProjectIds !== undefined) {
        await this.applyProjectChanges(tx)
      }

      return tx.task.update({
        where: { id: this.task.id },
        data: this.updates,
        include: {
          assignee: true,
          creator: true,
          assignments: {
            include: { user: { select: { id: true, name: true } } },
          },
          tags: { include: { tag: true } },
          projects: { include: { project: true } },
        },
      })
    })

    await this.saveHistory(updatedTask.id)
    await this.notifyAll(updatedTask)

    return { task: this.toResponse(updatedTask) }
  }

  private async applyTeamChanges(
    tx: Prisma.TransactionClient,
  ): Promise<{ userId: string; name: string; isLead: boolean }[]> {
    if (this.normalizedAssignments!.length === 0) {
      await tx.taskAssignment.deleteMany({ where: { taskId: this.task.id } })
      const next: { userId: string; name: string; isLead: boolean }[] = []

      if (JSON.stringify(this.teamBefore) !== JSON.stringify(next)) {
        this.historyEntries.push({
          type: 'TEAM_CHANGE',
          details: { from: this.teamBefore, to: next },
        })
      }
      return next
    }

    const keepIds = this.normalizedAssignments!.map((e) => e.userId)
    await tx.taskAssignment.deleteMany({
      where: { taskId: this.task.id, userId: { notIn: keepIds } },
    })
    await Promise.all(
      this.normalizedAssignments!.map((entry) =>
        tx.taskAssignment.upsert({
          where: {
            taskId_userId: { taskId: this.task.id, userId: entry.userId },
          },
          update: { isLead: entry.isLead },
          create: {
            taskId: this.task.id,
            userId: entry.userId,
            isLead: entry.isLead,
          },
        }),
      ),
    )

    const next = this.normalizedAssignments!.map((e) => ({
      userId: e.userId.toString(),
      name: e.name ?? `ID ${e.userId.toString()}`,
      isLead: e.isLead,
    }))

    if (JSON.stringify(this.teamBefore) !== JSON.stringify(next)) {
      this.historyEntries.push({
        type: 'TEAM_CHANGE',
        details: { from: this.teamBefore, to: next },
      })
    }

    return next
  }

  private async applyTagChanges(tx: Prisma.TransactionClient) {
    if (this.normalizedTagIds!.length === 0) {
      await tx.taskTag.deleteMany({ where: { taskId: this.task.id } })
    } else {
      await tx.taskTag.deleteMany({
        where: {
          taskId: this.task.id,
          tagId: { notIn: this.normalizedTagIds! },
        },
      })
      await tx.taskTag.createMany({
        data: this.normalizedTagIds!.map((tagId) => ({
          taskId: this.task.id,
          tagId,
        })),
        skipDuplicates: true,
      })
    }

    if (
      JSON.stringify(this.tagsBefore) !== JSON.stringify(this.normalizedTagIds)
    ) {
      this.historyEntries.push({
        type: 'TAG_CHANGE',
        details: { from: this.tagsBefore, to: this.normalizedTagIds },
      })
    }
  }

  private async applyProjectChanges(tx: Prisma.TransactionClient) {
    if (this.normalizedProjectIds!.length === 0) {
      await tx.taskProject.deleteMany({ where: { taskId: this.task.id } })
    } else {
      await tx.taskProject.deleteMany({
        where: {
          taskId: this.task.id,
          projectId: { notIn: this.normalizedProjectIds! },
        },
      })
      await tx.taskProject.createMany({
        data: this.normalizedProjectIds!.map((projectId) => ({
          taskId: this.task.id,
          projectId,
        })),
        skipDuplicates: true,
      })
    }

    if (
      JSON.stringify(this.projectsBefore) !==
      JSON.stringify(this.normalizedProjectIds)
    ) {
      this.historyEntries.push({
        type: 'PROJECT_CHANGE',
        details: { from: this.projectsBefore, to: this.normalizedProjectIds },
      })
    }
  }

  private async saveHistory(taskId: number) {
    if (this.historyEntries.length === 0) return
    await Promise.all(
      this.historyEntries.map((entry) =>
        logTaskHistory({
          taskId,
          actorId: this.user.id,
          type: entry.type,
          details: entry.details,
        }),
      ),
    )
  }

  private async notifyAll(
    updatedTask: Prisma.TaskGetPayload<{
      include: {
        creator: true
        assignee: true
        assignments: { include: { user: { select: { id: true; name: true } } } }
        tags: { include: { tag: true } }
        projects: { include: { project: true } }
      }
    }>,
  ) {
    if (this.notifyAssigneeId) {
      const deadlineText = updatedTask.deadline
        ? ` (дедлайн ${updatedTask.deadline.toLocaleDateString('ru-RU')})`
        : ''
      const managerName = this.user.name ?? 'менеджера'
      await sendTelegramNotification(
        this.notifyAssigneeId,
        `Вам назначена задача "${updatedTask.title}"${deadlineText} от ${managerName}.`,
      )
    }

    if (this.normalizedAssignments !== undefined) {
      await this.notifyTeamChanges(updatedTask)
    }

    const statusChanged =
      this.nextStatus && this.nextStatus !== this.task.status
    if (statusChanged && this.nextStatus) {
      const actorName =
        this.user.name ?? `ID ${this.user.id.toString()}`
      const statusLabel =
        STATUS_LABELS[this.nextStatus] ?? this.nextStatus
      const text = `Статус задачи "${updatedTask.title}" изменён на «${statusLabel}». Инициатор: ${actorName}.`
      await broadcastTaskNotification(updatedTask, text, this.user.id)
    }
  }

  private async notifyTeamChanges(
    updatedTask: {
      id: number
      title: string
      creatorId: bigint
      assigneeId: bigint | null
      creator: { id: bigint; name: string | null } | null
      assignee: { id: bigint; name: string | null } | null
      assignments: {
        userId: bigint
        user: { id: bigint; name: string | null } | null
      }[]
    },
  ) {
    const oldIds = new Set(this.teamBefore.map((t) => t.userId))
    const newIds = new Set(
      this.normalizedAssignments!.map((t) => t.userId.toString()),
    )
    const addedIds = this.normalizedAssignments!
      .filter((e) => !oldIds.has(e.userId.toString()))
      .map((e) => e.userId)
    const removedIds = this.teamBefore
      .filter((e) => !newIds.has(e.userId))
      .map((e) => BigInt(e.userId))

    const notifyBatch = (ids: bigint[], msg: string) =>
      ids.length > 0 &&
      Promise.all(ids.map((id) => sendTelegramNotification(id, msg)))

    await notifyBatch(
      addedIds,
      `Вы добавлены в команду задачи "${updatedTask.title}".`,
    )
    await notifyBatch(
      removedIds,
      `Вы исключены из команды задачи "${updatedTask.title}".`,
    )

    if (addedIds.length > 0 || removedIds.length > 0) {
      const changes: string[] = []
      if (addedIds.length > 0)
        changes.push(`добавлены: ${addedIds.length} чел.`)
      if (removedIds.length > 0)
        changes.push(`удалены: ${removedIds.length} чел.`)
      const msg = `Состав команды задачи "${updatedTask.title}" обновлён (${changes.join(', ')}).`

      const exclude = new Set([...addedIds, ...removedIds, this.user.id])
      const recipients = new Set<bigint>()
      if (updatedTask.creatorId) recipients.add(updatedTask.creatorId)
      if (updatedTask.assigneeId) recipients.add(updatedTask.assigneeId)
      updatedTask.assignments.forEach((a) => recipients.add(a.userId))
      exclude.forEach((id) => recipients.delete(id))

      await Promise.all(
        Array.from(recipients).map((id) =>
          sendTelegramNotification(id, msg),
        ),
      )
    }
  }

  private toResponse(task: {
    id: number
    title: string
    status: TaskStatus
    deadline: Date | null
    creatorId: bigint
    creator: { id: bigint; name: string | null } | null
    assigneeId: bigint | null
    assignee: { id: bigint; name: string | null } | null
    updatedAt: Date
    completedAt: Date | null
  }): TaskResponse {
    return {
      id: task.id.toString(),
      title: task.title,
      status: task.status,
      deadline: task.deadline ? task.deadline.toISOString() : null,
      creatorId: task.creatorId.toString(),
      creatorName: task.creator?.name ?? null,
      assigneeId: task.assigneeId?.toString() ?? null,
      assigneeName: task.assignee?.name ?? null,
      updatedAt: task.updatedAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    }
  }
}
