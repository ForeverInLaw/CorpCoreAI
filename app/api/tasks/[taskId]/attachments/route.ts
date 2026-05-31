import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'
import { saveExternalAttachment } from '@/lib/attachments'
import { ensureStorageRoot, buildStoredFilePath, toRelativeStoragePath } from '@/lib/storage'
import { bot } from '@/lib/bot'

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2GB (Telegram limit)
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'audio/mpeg', 'audio/ogg', 'audio/wav',
])
const MAX_MIME_TYPE_LENGTH = 200
function sanitizeFileName(name: string) {
  return name.replaceAll(/[^a-zA-Z0-9_.-]+/g, '_')
}

async function notifyManagerAboutAttachmentUploadFromWebApp({
  task,
  uploader,
  attachment,
}: {
  task: {
    id: number
    title: string
    creatorId: bigint
    creator: { role: 'EMPLOYEE' | 'MANAGER'; name: string | null } | null
  }
  uploader: { id: bigint; name?: string | null }
  attachment: { fileName?: string | null; type: string | null }
}) {
  if (task.creator?.role !== 'MANAGER') {
    return
  }

  if (task.creatorId === uploader.id) {
    return
  }

  const uploaderName = uploader.name ?? `ID ${uploader.id.toString()}`
  const attachmentLabel = attachment.fileName ?? attachment.type ?? 'файл'
  const message = [
    `Задача "${task.title}" получила новый файл: ${attachmentLabel}.`,
    `Загрузил: ${uploaderName}.`,
  ].join('\n')

  try {
    await bot.api.sendMessage(Number(task.creatorId), message)
  } catch (error) {
    console.error('Failed to notify manager about attachment upload (WebApp)', error)
  }
}

function canUploadToTask(task: { creatorId: bigint; assigneeId: bigint | null }, userId: bigint, role: 'EMPLOYEE' | 'MANAGER') {
  if (role === 'MANAGER') return true
  if (task.creatorId === userId) return true
  if (task.assigneeId && task.assigneeId === userId) return true
  return false
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> | { taskId: string } }) {
  const resolvedParams = 'then' in context.params ? await context.params : context.params
  const initData = request.headers.get('Authorization')
  if (!initData) {
    return NextResponse.json({ error: 'Authorization header missing' }, { status: 401 })
  }

  const taskIdRaw = resolvedParams.taskId
  const taskId = Number(taskIdRaw)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
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

  try {
    const telegramUser = await ensureTelegramUser({
      id: String(userId),
      name: userPayload.user?.first_name,
    })

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        assigneeId: true,
        creator: {
          select: {
            role: true,
            name: true,
          }
        }
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (!canUploadToTask(task, telegramUser.id, telegramUser.role)) {
      return NextResponse.json({ error: 'You are not allowed to upload files for this task' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File exceeds 2GB limit' }, { status: 413 })
    }

    const mimeType = file.type || ''
    if (mimeType.length > MAX_MIME_TYPE_LENGTH || (mimeType && !ALLOWED_MIME_TYPES.has(mimeType))) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 415 })
    }

    await ensureStorageRoot()

    const originalName = 'name' in file && file.name ? file.name : 'upload.bin'
    const safeName = sanitizeFileName(originalName)
    const uniqueName = `${taskId}-${Date.now()}-${randomUUID()}-${safeName}`
    const destPath = buildStoredFilePath(uniqueName)
    const storagePath = toRelativeStoragePath(destPath)

    const nodeStream = Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream)
    await pipeline(nodeStream, createWriteStream(destPath))

    const attachment = await saveExternalAttachment({
      taskId,
      uploadedById: telegramUser.id,
      fileName: originalName,
      mimeType: file.type || undefined,
      sizeBytes: typeof file.size === 'number' ? file.size : undefined,
      storagePath,
    })

    await notifyManagerAboutAttachmentUploadFromWebApp({ task, uploader: telegramUser, attachment })

    return NextResponse.json({
      attachment: {
        id: attachment.id.toString(),
        url: attachment.url,
        type: attachment.type,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to upload attachment', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
