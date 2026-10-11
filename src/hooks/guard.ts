import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findBookRoot, isProtected, resolveInBook } from '../shared/bookpath'
import { parseYamlText } from '../shared/schemas'

export interface HookInput { cwd: string; tool_name: string; tool_input: Record<string, unknown> }
type Decision = { allow: true } | { allow: false; reason: string }

// Documented path fields: Write/Edit `file_path`. MultiEdit and NotebookEdit `notebook_path` are not on the
// hooks page (see docs/facts.md), so NotebookEdit also falls back to `file_path`.
const WRITE_FIELDS: Record<string, string[]> = {
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path', 'file_path']
}
const SHELL_TOOLS = ['Bash', 'PowerShell']
const SAFE_CHARS = /^[A-Za-z0-9 ._/^~:=-]+$/
const ARG = /^[A-Za-z0-9._/^~:-]+$/
const GIT_FLAGS = new Set(['--stat', '--shortstat', '--numstat', '--summary', '--name-only', '--name-status', '--oneline', '--cached', '--staged', '-p', '--patch', '--no-color'])
const ACCEPT_RE = /^node (?:\.novelbrain\/|\.\/\.novelbrain\/|\.novelbrain\\|\.\\\.novelbrain\\)accept\.mjs SC-\d{3,}(?: --touchup| --sealed)?$/
const isArg = (t: string) => ARG.test(t) && !t.startsWith('-')

// Token allowlist: git can write files (--output), run programs (--ext-diff, -c) or read outside the book (--no-index).
function shellAllowed(cmd: string): boolean {
  if (ACCEPT_RE.test(cmd)) return true
  if (!SAFE_CHARS.test(cmd)) return false
  const t = cmd.split(' ')
  if (t.some(x => x === '')) return false
  if (t[0] !== 'git' || !['diff', 'log', 'show'].includes(t[1])) return false
  let paths = false
  for (let i = 2; i < t.length; i++) {
    const x = t[i]
    if (paths || !x.startsWith('-')) { if (!isArg(x)) return false; continue }
    if (x === '--') paths = true
    else if (x === '-n') { if (!/^\d+$/.test(t[++i] ?? '')) return false }
    else if (!(GIT_FLAGS.has(x) || /^-\d+$/.test(x) || /^--max-count=\d+$/.test(x))) return false
  }
  return true
}
const block = (reason: string): Decision => ({ allow: false, reason })

function archived(root: string): boolean {
  try {
    return (parseYamlText(readFileSync(join(root, 'book.yaml'), 'utf8')) as { status?: string })?.status === 'archived'
  } catch {
    return true // fail closed: unreadable book.yaml blocks writes
  }
}

export function decide(input: HookInput): Decision {
  try {
    const { tool_name, tool_input, cwd } = input
    if (SHELL_TOOLS.includes(tool_name)) {
      const cmd = String(tool_input.command ?? '').trim()
      return shellAllowed(cmd)
        ? { allow: true }
        : block(`Novel Brain allows only read-only git (diff, log, show) and "node .novelbrain/accept.mjs SC-###" (optionally with --touchup or --sealed) in the shell. Refused: ${cmd}`)
    }
    if (/^mcp__/.test(tool_name)) return block('MCP tools are not allowed inside a Novel Brain book.')
    const fields = WRITE_FIELDS[tool_name]
    if (!fields) return { allow: true }
    const root = findBookRoot(cwd)
    if (!root) return block('No book.yaml found above the working directory, so writes are not allowed.')
    if (archived(root)) return block('This book is archived or its book.yaml is unreadable, so it cannot be changed.')
    const target = fields.map(f => tool_input[f]).find(v => typeof v === 'string' && v.trim() !== '') as string | undefined
    if (!target) return block('This write has no file path, so it was blocked.')
    const { inside, rel } = resolveInBook(root, target)
    if (!inside) return block(`${target} is outside this book. Write only inside the book folder.`)
    if (isProtected(rel))
      return block(`${rel} is protected. Canon, the manuscript, run state, book.yaml and kit files are written only by Novel Brain. Write drafts to drafts/ and canon changes as proposals in proposals/.`)
    return { allow: true }
  } catch {
    return block('Novel Brain guard hit an error, so the action was blocked.')
  }
}

export function main(stdinText: string): { code: number; stderr: string } {
  let input: HookInput
  try {
    input = JSON.parse(stdinText)
  } catch {
    return { code: 2, stderr: 'Novel Brain guard could not read the hook input, so the action was blocked.' }
  }
  const d = decide(input)
  return d.allow ? { code: 0, stderr: '' } : { code: 2, stderr: d.reason }
}

if (process.argv[1] && /guard\.(mjs|ts)$/.test(process.argv[1])) {
  const r = main(readFileSync(0, 'utf8'))
  if (r.stderr) process.stderr.write(r.stderr + '\n')
  process.exit(r.code)
}
