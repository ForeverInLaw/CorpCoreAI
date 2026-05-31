import type { Prisma, TaskHistoryType } from '@prisma/client'

import { prisma } from './db'

export type { TaskHistoryType }

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
      actor: {
        select: {
          name: true,
        },
      },
    },
  })

  return history.map((entry) => ({
    ...entry,
    type: entry.type as TaskHistoryType,
    actorName: entry.actor?.name ?? null,
  }))
}
