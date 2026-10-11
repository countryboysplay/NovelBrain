import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Machine-specific (absolute app paths), so it lives in settings.local.json, which books git-ignore.
export function writeBookSettings(bookDir: string, hooksDir: string): string {
  const dir = hooksDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const cmd = (name: string) => ({ type: 'command', command: `node "${dir}/${name}.mjs"` })
  // SessionEnd defaults to a 1.5 s budget, so every memory entry sets its own timeout.
  const mem = (arg: string) => [{ hooks: [{ type: 'command', command: `node "${dir}/memory.mjs" ${arg}`, timeout: 10 }] }]
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*', hooks: [cmd('guard')] }],
      PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [cmd('validate')] }],
      SessionStart: mem('start'),
      SessionEnd: mem('enqueue'),
      PreCompact: mem('enqueue')
    }
  }
  mkdirSync(join(bookDir, '.claude'), { recursive: true })
  const file = join(bookDir, '.claude', 'settings.local.json')
  writeFileSync(file, JSON.stringify(settings, null, 2))
  return file
}
