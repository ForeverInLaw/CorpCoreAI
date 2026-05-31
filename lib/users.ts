import { Role, User } from '@prisma/client'
import { prisma } from './db'

const managerIds = new Set(
  (process.env.MANAGER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)

const whitelistIds = new Set(
  (process.env.WHITELIST || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)

export function isWhitelistedTelegramId(userId: string | bigint): boolean {
  return whitelistIds.has(String(userId))
}

export function resolveRoleForTelegramId(userId: string | bigint): Role {
  return managerIds.has(String(userId)) ? 'MANAGER' : 'EMPLOYEE'
}

export async function ensureTelegramUser({
  id,
  name,
}: {
  id: string | bigint
  name?: string | null
}): Promise<User> {
  const targetRole = resolveRoleForTelegramId(id)
  const bigintId = BigInt(id)

  return prisma.user.upsert({
    where: { id: bigintId },
    create: {
      id: bigintId,
      role: targetRole,
      name: name ?? null,
    },
    update: {
      role: targetRole,
      ...(name ? { name } : {}),
    },
  })
}
