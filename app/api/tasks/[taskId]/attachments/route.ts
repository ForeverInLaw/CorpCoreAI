import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'
import { saveExternalAttachment } from '@/lib/attachments'
import { ensureStorageRoot, buildStoredFilePath, toRelativeStoragePath } from '@/lib/storage'

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2GB (Telegram limit)
function sanitizeFileName(name: string) {
  return name.replaceAll(/[^a-zA-Z0-9_.-]+/g, '_')
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

  const numericUserId = Number(userPayload.user?.id)
  if (!numericUserId || Number.isNaN(numericUserId)) {
    return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
  }

  if (!isWhitelistedTelegramId(numericUserId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    const telegramUser = await ensureTelegramUser({
      id: numericUserId,
      name: userPayload.user?.first_name,
    })

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, creatorId: true, assigneeId: true },
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

    await ensureStorageRoot()

    const originalName = 'name' in file && file.name ? file.name : 'upload.bin'
    const safeName = sanitizeFileName(originalName)
    const uniqueName = `${taskId}-${Date.now()}-${randomUUID()}-${safeName}`
    const destPath = buildStoredFilePath(uniqueName)
    const storagePath = toRelativeStoragePath(destPath)

    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(destPath, buffer)

    const attachment = await saveExternalAttachment({
      taskId,
      uploadedById: telegramUser.id,
      fileName: originalName,
      mimeType: file.type || undefined,
      sizeBytes: typeof file.size === 'number' ? file.size : undefined,
      storagePath,
    })

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
