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

  let record: DownloadTokenRecord
  try {
    record = (await prisma.downloadToken.delete({
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
    })) as DownloadTokenRecord
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2025') {
      return { record: null, expired: false }
    }
    throw e
  }

  const expired = record.expiresAt.getTime() <= now.getTime()
  return { record, expired }
}
