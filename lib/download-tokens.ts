import type { Attachment, DownloadToken } from '@prisma/client'

import { prisma } from './db'

export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000

export type DownloadTokenRecord = DownloadToken & {
  attachment: Attachment & {
    task: {
      creatorId: bigint
      assigneeId: bigint | null
    }
  }
}

export async function createDownloadToken(attachmentId: number, ttlMs = DOWNLOAD_TOKEN_TTL_MS) {
  const expiresAt = new Date(Date.now() + ttlMs)

  return prisma.downloadToken.create({
    data: {
      attachmentId,
      expiresAt,
    },
  })
}

export async function consumeDownloadToken(token: string): Promise<{ record: DownloadTokenRecord | null; expired: boolean }> {
  const now = new Date()

  const record = (await prisma.downloadToken.findUnique({
    where: { token },
    include: {
      attachment: {
        include: {
          task: {
            select: {
              creatorId: true,
              assigneeId: true,
            },
          },
        },
      },
    },
  })) as DownloadTokenRecord | null

  if (!record) {
    return { record: null, expired: false }
  }

  await prisma.downloadToken.delete({ where: { token } })

  const expired = record.expiresAt.getTime() <= now.getTime()
  return { record, expired }
}
