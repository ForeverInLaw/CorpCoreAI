import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const forwarded = request.headers.get('x-forwarded-for')
    const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
    const userId = request.headers.get('Authorization') || ''
    const identifier = userId ? `user:${userId}:${ip}` : `ip:${ip}`

    const { rateLimited } = checkRateLimit(identifier)
    if (rateLimited) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
