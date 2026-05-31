import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'
import { createDownloadToken } from '@/lib/download-tokens'

function canAccessAttachment(
  task: { creatorId: bigint; assigneeId: bigint | null; assignments?: { userId: bigint }[] },
  userId: bigint,
  role: 'EMPLOYEE' | 'MANAGER'
) {
  if (role === 'MANAGER') return true
  if (task.creatorId === userId) return true
  if (task.assigneeId && task.assigneeId === userId) return true
  if (task.assignments?.some((a) => a.userId === userId)) return true
  return false
}

export async function POST(request: Request, context: { params: Promise<{ attachmentId: string }> | { attachmentId: string } }) {
  const resolvedParams = 'then' in context.params ? await context.params : context.params
  const initData = request.headers.get('Authorization')
  if (!initData) {
    return NextResponse.json({ error: 'Authorization header missing' }, { status: 401 })
  }

  const attachmentId = Number(resolvedParams.attachmentId)
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    return NextResponse.json({ error: 'Invalid attachment ID' }, { status: 400 })
  }

  const userPayload = validateTelegramWebAppData(initData)
  if (!userPayload) {
    return NextResponse.json({ error: 'Invalid initData' }, { status: 403 })
  }

  const userId = userPayload.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
  }

  if (!isWhitelistedTelegramId(userId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const telegramUser = await ensureTelegramUser({
    id: userId,
    name: userPayload.user?.first_name,
  })

  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      task: {
        select: {
          creatorId: true,
          assigneeId: true,
          assignments: { select: { userId: true } },
        },
      },
    },
  })

  if (!attachment || !attachment.task) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  if (!canAccessAttachment(attachment.task, telegramUser.id, telegramUser.role)) {
    return NextResponse.json({ error: 'You are not allowed to download this attachment' }, { status: 403 })
  }

  const token = await createDownloadToken(attachment.id)
  const downloadUrl = `/api/attachments/download/${token.token}`

  return NextResponse.json({ token: token.token, url: downloadUrl, expiresAt: token.expiresAt.toISOString() })
}
