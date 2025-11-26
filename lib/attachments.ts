import { AttachmentSource } from '@prisma/client'

import { prisma } from './db'

function detectExtension(fileName?: string | null, mimeType?: string | null): string | null {
  if (fileName) {
    const match = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName)
    if (match) {
      return match[1]
    }
  }

  if (mimeType) {
    const lookup: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
    }

    if (lookup[mimeType]) {
      return lookup[mimeType]
    }
  }

  return null
}

export function formatAttachmentType(fileName?: string | null, mimeType?: string | null): string {
  const ext = detectExtension(fileName, mimeType)
  return ext ? `FILE (.${ext.toUpperCase()})` : 'FILE'
}

export type TelegramAttachmentPayload = {
  taskId: number
  uploadedById: bigint
  telegramFileId: string
  telegramUniqueFileId?: string | null
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  fileUrl?: string | null
  type?: string | null
}

export async function saveTelegramAttachment(payload: TelegramAttachmentPayload) {
  const {
    taskId,
    uploadedById,
    telegramFileId,
    telegramUniqueFileId,
    fileName,
    mimeType,
    sizeBytes,
    fileUrl,
    type,
  } = payload

  const normalizedType = type ?? formatAttachmentType(fileName, mimeType)
  const resolvedUrl = fileUrl ?? `telegram-file://${telegramFileId}`

  return prisma.attachment.create({
    data: {
      taskId,
      uploadedById,
      url: resolvedUrl,
      type: normalizedType,
      source: AttachmentSource.TELEGRAM,
      telegramFileId,
      telegramUniqueFileId,
      fileName,
      mimeType,
      sizeBytes: sizeBytes ?? undefined,
      storagePath: null,
    },
  })
}

export type ExternalAttachmentPayload = {
  taskId: number
  uploadedById: bigint
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  storagePath: string
  url?: string | null
  type?: string | null
}

export async function saveExternalAttachment(payload: ExternalAttachmentPayload) {
  const { taskId, uploadedById, fileName, mimeType, sizeBytes, url, storagePath, type } = payload
  const normalizedType = type ?? formatAttachmentType(fileName, mimeType)

  return prisma.attachment.create({
    data: {
      taskId,
      uploadedById,
      url: url ?? storagePath,
      storagePath,
      type: normalizedType,
      source: AttachmentSource.EXTERNAL,
      telegramFileId: null,
      telegramUniqueFileId: null,
      fileName,
      mimeType,
      sizeBytes: sizeBytes ?? undefined,
    },
  })
}
