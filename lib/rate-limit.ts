const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const WINDOW_MS = 60 * 1000 // 1 minute
const MAX_REQUESTS = 60

export function checkRateLimit(identifier: string): { rateLimited: boolean; remaining: number } {
  const now = Date.now()
  const entry = rateLimitMap.get(identifier)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + WINDOW_MS })
    return { rateLimited: false, remaining: MAX_REQUESTS - 1 }
  }

  entry.count++

  if (entry.count > MAX_REQUESTS) {
    return { rateLimited: true, remaining: 0 }
  }

  return { rateLimited: false, remaining: MAX_REQUESTS - entry.count }
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key)
    }
  }
}, WINDOW_MS)
