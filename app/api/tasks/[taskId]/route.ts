import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'
import { TaskUpdateService } from '@/lib/task-update-service'

function canModifyTask(
  task: {
    creatorId: bigint
    assigneeId: bigint | null
    assignments?: { userId: bigint }[]
  },
  user: { id: bigint; role: 'EMPLOYEE' | 'MANAGER' },
) {
  if (user.role === 'MANAGER') return true
  if (task.creatorId === user.id) return true
  if (task.assigneeId && task.assigneeId === user.id) return true
  if (task.assignments?.some((a) => a.userId === user.id)) return true
  return false
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> | { taskId: string } },
) {
  const resolvedParams =
    'then' in context.params ? await context.params : context.params
  const taskIdNumber = Number(resolvedParams.taskId)
  if (!Number.isInteger(taskIdNumber) || taskIdNumber <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  const initData = request.headers.get('Authorization')
  if (!initData) {
    return NextResponse.json(
      { error: 'Authorization header missing' },
      { status: 401 },
    )
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

  const telegramUser = await ensureTelegramUser({
    id: String(userId),
    name: userPayload.user?.first_name,
  })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const task = await prisma.task.findUnique({
    where: { id: taskIdNumber },
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

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (!canModifyTask(task, telegramUser)) {
    return NextResponse.json(
      { error: 'You are not allowed to modify this task' },
      { status: 403 },
    )
  }

  const result = await TaskUpdateService.execute(telegramUser, task, body)
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    )
  }

  return NextResponse.json({ task: result.task })
}
