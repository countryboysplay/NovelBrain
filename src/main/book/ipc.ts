import { isAbsolute } from 'node:path'
import type { NewBookOpts } from './create'

// Renderer-supplied book:open paths are only honoured for books already in the recent list.
export const isAllowedBookPath = (p: unknown, recent: string[]): p is string =>
  typeof p === 'string' && isAbsolute(p) && recent.some(r => r.toLowerCase() === p.toLowerCase())

// Shape check only; newBook's Zod schema validates the values.
export const isNewBookOpts = (o: unknown): o is NewBookOpts => {
  const x = o as Record<string, unknown> | null
  return (
    !!x && typeof x === 'object' && typeof x.title === 'string' && x.title.trim() !== '' &&
    typeof x.audience === 'string' && Array.isArray(x.genres) && typeof x.wordTarget === 'number'
  )
}
