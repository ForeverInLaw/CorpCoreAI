import type { Prisma } from '@prisma/client'

import { prisma } from './db'

export type TaskHistoryType =
  | 'STATUS_CHANGE'
  | 'DEADLINE_CHANGE'
  | 'ASSIGNEE_CHANGE'
  | 'OVERDUE_REASON'
  | 'TEAM_CHANGE'
  | 'TAG_CHANGE'
  | 'PROJECT_CHANGE'
  | 'REVIEW_STATUS_CHANGE'

export type TaskHistoryDetails = Prisma.InputJsonValue

export async function logTaskHistory({
  taskId,
  actorId,
  type,
  details,
}: {
  taskId: number
  actorId?: bigint | null
  type: TaskHistoryType
  details?: TaskHistoryDetails
}) {
  return prisma.taskHistory.create({
    data: {
      taskId,
      actorId: actorId ?? undefined,
      type,
      details: details ?? undefined,
    },
  })
}

export async function getTaskHistory(taskId: number) {
  const history = await prisma.taskHistory.findMany({
    where: {
      taskId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      user: {
        select: {
          name: true,
        },
      },
    },
  })

  return history.map((entry) => ({
    ...entry,
    actorName: entry.user?.name ?? null,
  }))
}
