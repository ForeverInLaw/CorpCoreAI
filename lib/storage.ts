import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'uploads')

export async function ensureStorageRoot() {
  await mkdir(STORAGE_ROOT, { recursive: true })
}

export function buildStoredFilePath(fileName: string) {
  return path.join(STORAGE_ROOT, fileName)
}

export function toRelativeStoragePath(absolutePath: string) {
  return path.relative(process.cwd(), absolutePath)
}

export function resolveStoragePath(storagePath: string) {
  const resolved = path.isAbsolute(storagePath)
    ? path.resolve(storagePath)
    : path.resolve(process.cwd(), storagePath)

  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw new Error('Path traversal detected: storage path resolves outside STORAGE_ROOT')
  }

  return resolved
}

export function getStorageRoot() {
  return STORAGE_ROOT
}
