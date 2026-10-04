import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Machine-specific (absolute app paths), so it lives in settings.local.json, which books git-ignore.
export function writeBookSettings(bookDir: string, hooksDir: string): string {
  const dir = hooksDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const cmd = (name: string) => ({ type: 'command', command: `node "${dir}/${name}.mjs"` })
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*', hooks: [cmd('guard')] }],
      PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [cmd('validate')] }]
    }
  }
  mkdirSync(join(bookDir, '.claude'), { recursive: true })
  const file = join(bookDir, '.claude', 'settings.local.json')
  writeFileSync(file, JSON.stringify(settings, null, 2))
  return file
}
