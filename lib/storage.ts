import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'uploads')

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
  return path.isAbsolute(storagePath) ? storagePath : path.join(process.cwd(), storagePath)
}

export function getStorageRoot() {
  return STORAGE_ROOT
}
