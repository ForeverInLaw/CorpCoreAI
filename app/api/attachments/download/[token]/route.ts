import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'

import { consumeDownloadToken } from '@/lib/download-tokens'
import { resolveStoragePath } from '@/lib/storage'

const botToken = process.env.BOT_TOKEN

if (!botToken) {
  throw new Error('BOT_TOKEN is not defined for attachment download route')
}

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${botToken}`
const TELEGRAM_FILE_BASE = `https://api.telegram.org/file/bot${botToken}`

function isTelegramAttachment(url: string | null | undefined) {
  return typeof url === 'string' && url.startsWith('telegram-file://')
}

function sanitizeFileName(name: string): string {
  return name.replace(/["\r\n]/g, '_')
}

async function fetchTelegramFile(telegramFileId: string) {
  const response = await fetch(`${TELEGRAM_API_BASE}/getFile?file_id=${encodeURIComponent(telegramFileId)}`)
  if (!response.ok) {
    throw new Error('Failed to resolve Telegram file')
  }

  const payload = await response.json()
  const filePath = payload?.result?.file_path as string | undefined
  if (!filePath) {
    throw new Error('Telegram file_path missing')
  }

  const fileResponse = await fetch(`${TELEGRAM_FILE_BASE}/${filePath}`)
  if (!fileResponse.ok) {
    throw new Error('Failed to download Telegram file')
  }

  return fileResponse
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> | { token: string } }) {
  const resolvedParams = 'then' in context.params ? await context.params : context.params
  const token = resolvedParams.token

  const { record, expired } = await consumeDownloadToken(token)
  if (!record) {
    return NextResponse.json({ error: 'Download link not found' }, { status: 404 })
  }

  if (expired) {
    return NextResponse.json({ error: 'Download link expired' }, { status: 410 })
  }

  const attachment = record.attachment

  if (isTelegramAttachment(attachment.url) && attachment.telegramFileId) {
    try {
      const fileResponse = await fetchTelegramFile(attachment.telegramFileId)
      const headers = new Headers(fileResponse.headers)
      headers.set('Content-Disposition', `attachment; filename="${sanitizeFileName(attachment.fileName ?? attachment.type)}"`)
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('X-Accel-Buffering', 'no')
      return new NextResponse(fileResponse.body, {
        status: fileResponse.status,
        headers,
      })
    } catch (error) {
      console.error('Failed to proxy Telegram file', error)
      return NextResponse.json({ error: 'Failed to download file' }, { status: 502 })
    }
  }

  if (!attachment.storagePath) {
    return NextResponse.json({ error: 'Attachment storage path missing' }, { status: 500 })
  }

  try {
    const absolutePath = resolveStoragePath(attachment.storagePath)
    const buffer = await readFile(absolutePath)
    const headers = new Headers()
    if (attachment.mimeType) {
      headers.set('Content-Type', attachment.mimeType)
    }
    headers.set('Content-Disposition', `attachment; filename="${sanitizeFileName(attachment.fileName ?? attachment.type)}"`)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Content-Length', buffer.byteLength.toString())
    return new NextResponse(buffer, { status: 200, headers })
  } catch (error) {
    console.error('Failed to read attachment from storage', error)
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 })
  }
}
