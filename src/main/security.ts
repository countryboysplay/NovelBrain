import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute, join } from 'node:path'

export function isAllowedUrl(raw: string, projectDir: string | null): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'http:') return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'file:' || !projectDir) return false
  let target: string
  try {
    target = resolve(fileURLToPath(url))
  } catch {
    return false
  }
  const rel = relative(join(projectDir, 'graphify-out'), target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** A guest may attach only in its own in-memory `codeburn` partition, never the app's default session, and only at an allowed URL. */
export const allowAttach = (params: Record<string, string>, projectDir: string | null): boolean =>
  params.partition === 'codeburn' && isAllowedUrl(params.src, projectDir)
