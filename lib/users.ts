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

  const existing = await prisma.user.findUnique({ where: { id: bigintId } })
  if (existing) {
    if (existing.role !== targetRole || (name && name !== existing.name)) {
      return prisma.user.update({
        where: { id: bigintId },
        data: {
          role: targetRole,
          name: name ?? existing.name,
        },
      })
    }

    return existing
  }

  return prisma.user.create({
    data: {
      id: bigintId,
      role: targetRole,
      name: name ?? null,
    },
  })
}
