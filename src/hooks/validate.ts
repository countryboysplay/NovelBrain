import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findBookRoot, resolveInBook } from '../shared/bookpath'
import { parseFrontmatter, parseYamlText, schemaFor } from '../shared/schemas'
import type { HookInput } from './guard'

const PATH_FIELD: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path' }

export function check(input: HookInput): { ok: true } | { ok: false; message: string } {
  const field = PATH_FIELD[input.tool_name]
  const root = field ? findBookRoot(input.cwd) : null
  if (!field || !root) return { ok: true }
  const { inside, rel } = resolveInBook(root, String(input.tool_input[field] ?? ''))
  const rule = inside ? schemaFor(rel) : null
  if (!rule) return { ok: true }
  const fail = (why: string) => ({ ok: false as const, message: `${rel} is not valid: ${why} Fix the file so it matches the Novel Brain format.` })
  let value: unknown
  try {
    const raw = readFileSync(join(root, rel), 'utf8')
    if (rule.frontmatter) {
      const fm = parseFrontmatter(raw)
      if (!fm) return fail('it needs a frontmatter block between --- lines.')
      value = fm.data
    } else value = parseYamlText(raw)
  } catch (e) {
    return fail(`the YAML could not be read (${(e as Error).message.split('\n')[0]}).`)
  }
  const r = rule.schema.safeParse(value)
  return r.success ? { ok: true } : fail(r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') + '.')
}

function isValidInput(v: unknown): v is HookInput {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).tool_name === 'string' && typeof (v as Record<string, unknown>).tool_input === 'object' && (v as Record<string, unknown>).tool_input !== null
}

export function main(stdinText: string): { code: number; stderr: string } {
  let input: unknown
  try {
    input = JSON.parse(stdinText)
  } catch {
    return { code: 0, stderr: '' }
  }
  if (!isValidInput(input)) return { code: 0, stderr: '' }
  let r: ReturnType<typeof check>
  try {
    r = check(input)
  } catch {
    return { code: 0, stderr: '' }
  }
  return r.ok ? { code: 0, stderr: '' } : { code: 2, stderr: r.message }
}

if (process.argv[1] && /validate\.(mjs|ts)$/.test(process.argv[1])) {
  const r = main(readFileSync(0, 'utf8'))
  if (r.stderr) process.stderr.write(r.stderr + '\n')
  process.exit(r.code)
}
