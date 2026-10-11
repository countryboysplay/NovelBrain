import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findBookRoot } from '../shared/bookpath'

// SessionStart: print the book's briefing into context. SessionEnd/PreCompact: queue a distill job.
// Synchronous, silent, always exit 0: a memory hiccup must never block a session.
try {
  if (process.env.NB_DISTILLER !== '1') {
    const input = JSON.parse(readFileSync(0, 'utf8')) as Record<string, unknown>
    const root = findBookRoot(typeof input.cwd === 'string' ? input.cwd : process.cwd())
    const event = process.argv[2]
    const mem = process.env.NB_MEMORY_DIR ?? join(homedir(), '.novelbrain', 'memory')
    if (root && event === 'start') {
      // The runner checks for this line: it proves settings.local.json, and so the guard, loaded (docs/facts.md).
      process.stdout.write('Novel Brain hooks loaded.\n')
      const brief = join(root, '.novelbrain', 'memory.md')
      if (existsSync(brief)) process.stdout.write(readFileSync(brief, 'utf8'))
    } else if (root && event === 'enqueue' && typeof input.transcript_path === 'string') {
      if (existsSync(mem)) appendFileSync(join(mem, '.queue'), `${JSON.stringify({ kind: 'distill', transcript: input.transcript_path, book: root })}\n`)
    }
  }
} catch {}
process.exit(0)
