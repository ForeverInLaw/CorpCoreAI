import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const auth = request.headers.get('Authorization') || ''
    const identifier = auth || request.headers.get('x-real-ip') || 'anonymous'

    const { rateLimited } = checkRateLimit(identifier)
    if (rateLimited) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 },
      )
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
