import type { Prisma } from '@prisma/client'

import { prisma } from './db'

export type TaskHistoryType =
  | 'STATUS_CHANGE'
  | 'DEADLINE_CHANGE'
  | 'ASSIGNEE_CHANGE'
  | 'OVERDUE_REASON'

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
