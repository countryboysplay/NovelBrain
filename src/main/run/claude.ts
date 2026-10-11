import { killTree, runShell } from '../run'
import { claudeEnv } from '../claudeEnv'
import { usageFromStream, type Usage } from '../../shared/usage'

export class UsageLimitError extends Error {
  constructor(readonly resetAt: string | null) {
    super(resetAt ? `Claude usage limit reached. Resets ${resetAt}.` : 'Claude usage limit reached.')
  }
}

/** The book's memory hook prints this first on SessionStart; seeing it proves settings.local.json, and so the guard, loaded. */
export const HOOK_LINE = 'Novel Brain hooks loaded.'

export class KitMissingError extends Error {
  constructor(readonly version: string | null) {
    super(`Claude Code ${version ?? '(version unknown)'} started without the book's hooks or kit, so Novel Brain stopped before it could write. Update Novel Brain, or report this Claude Code version.`)
  }
}

type StartEvent = { type?: unknown; subtype?: unknown; hook_event?: unknown; outcome?: unknown; stdout?: unknown; agents?: unknown; slash_commands?: unknown; claude_code_version?: unknown }
/** Reads a step's stream up to init (hook events come first, docs/facts.md): null until init, then whether the hooks and kit loaded. */
export function kitCheck(): (v: unknown) => { ok: boolean; version: string | null } | null {
  let hook = false
  return v => {
    const e = (v && typeof v === 'object' ? v : {}) as StartEvent
    if (e.type !== 'system') return null
    if (e.subtype === 'hook_response' && e.hook_event === 'SessionStart' && e.outcome === 'success' && typeof e.stdout === 'string' && e.stdout.startsWith(HOOK_LINE)) hook = true
    if (e.subtype !== 'init') return null
    const has = (l: unknown, n: string) => Array.isArray(l) && l.includes(n)
    return { ok: hook && has(e.agents, 'author') && has(e.slash_commands, 'write-scene'), version: typeof e.claude_code_version === 'string' ? e.claude_code_version : null }
  }
}

// Detector strings recorded in docs/facts.md (Imagineer origin; the legacy epoch form is unverified).
export function parseUsageLimit(text: string): UsageLimitError | null {
  const epoch = text.match(/limit reached\|(\d{10})/i)
  if (!epoch && !/usage limit reached|hit your limit/i.test(text)) return null
  if (epoch) return new UsageLimitError(new Date(Number(epoch[1]) * 1000).toLocaleString())
  const m = text.match(/resets\s+(?:at\s+)?([^\n"]+)/i)
  return new UsageLimitError(m ? m[1].trim() : null)
}

export interface StepResult {
  step: string
  id: string
  outcome: string
  rounds?: number
  commit?: string | null
  revise?: string[]
  note?: string
}

// The showrunner's contract: the last line of its reply that parses as a step object.
export function parseStepResult(result: string): StepResult | null {
  for (const raw of result.split(/\r?\n/).reverse()) {
    const line = raw.trim().replace(/^`+|`+$/g, '')
    if (!line.startsWith('{')) continue
    try {
      const v = JSON.parse(line)
      if (v && typeof v === 'object' && typeof v.step === 'string' && typeof v.id === 'string' && typeof v.outcome === 'string') return v
    } catch {
      // not JSON; keep looking upward
    }
  }
  return null
}

type ResultLine = { type?: string; is_error?: boolean; result?: string; total_cost_usd?: number }
/** stream-json output, one JSON object per line: the reply is the last `result` line, plan usage the last usable `rate_limit_event`. */
export function parseStream(output: string): { json: ResultLine | null; usage: Usage | null } {
  let json: ResultLine | null = null, usage: Usage | null = null
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if ((v as ResultLine | null)?.type === 'result') json = v as ResultLine
    usage = usageFromStream(v) ?? usage
  }
  return { json, usage }
}

export interface ClaudeRun { result: string; costUsd: number; json: unknown }

export async function runClaude(
  prompt: string,
  o: { cwd: string; command: string; model: string; timeoutMs: number; headroomUrl?: string; maxTurns?: number; onSpawn?: (pid: number | undefined) => void; onUsage?: (u: Usage) => void
    // Each stream-json line as it comes (the Writers' room).
    onEvent?: (v: unknown) => void
    // Kill the step at init unless the book's hooks and kit loaded; onVersion gets init's Claude Code version.
    requireKit?: boolean; onVersion?: (v: string) => void
    // null omits --settings; default is the book's settings.local.json.
    settings?: string | null; allowedTools?: string[]; disallowedTools?: string[]; env?: Record<string, string> }
): Promise<ClaudeRun> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(o.model)) throw new Error(`invalid model name: ${JSON.stringify(o.model)}`)
  const tools = o.allowedTools
  const denied = o.disallowedTools ?? []
  for (const list of [tools ?? [], denied])
    if (list.some(t => !/^[A-Za-z]+$/.test(t))) throw new Error(`invalid tool name in ${JSON.stringify(list)}`)
  const settings = o.settings === undefined ? `${o.cwd}/.claude/settings.local.json` : o.settings
  const args = ['-p', '--output-format stream-json', '--verbose', `--model ${o.model}`, '--permission-mode acceptEdits']
  if (settings !== null) args.push(`--settings "${settings}"`)
  if (tools) args.push(...(tools.length ? [`--allowedTools ${tools.join(',')}`] : []), '--strict-mcp-config')
  if (denied.length) args.push(`--disallowedTools ${denied.join(',')}`)
  if (o.maxTurns) args.push(`--max-turns ${o.maxTurns}`)
  const t0 = Date.now()
  const onEvent = o.onEvent, check = o.requireKit ? kitCheck() : null
  let started: { ok: boolean; version: string | null } | null = null, pid: number | undefined
  const onLine = onEvent || check ? (line: string) => {
    if (!line.trim().startsWith('{')) return
    let v: unknown
    try { v = JSON.parse(line) } catch { return }
    if (check && !started && (started = check(v))) {
      if (started.version) try { o.onVersion?.(started.version) } catch { /* display only */ }
      // Tools run only after init, so killing here stops the step before it can write.
      if (!started.ok) killTree(pid)
    }
    if (started && !started.ok) return
    // Display only: a bad line or a throwing listener never fails the step.
    try { onEvent?.(v) } catch { /* ignored */ }
  } : undefined
  // ponytail: the whole verbose stream is held in memory; if long steps make it large, parse lines through runShell's onLine
  // and keep only the last result line, the last usage reading and a 1,000-character tail.
  const { code, output } = await runShell(`"${o.command}" ${args.join(' ')}`, onLine, {
    cwd: o.cwd,
    input: prompt,
    env: { ...claudeEnv(process.env as Record<string, string>, { headroomUrl: o.headroomUrl }), ...o.env },
    timeoutMs: o.timeoutMs,
    onSpawn: p => { pid = p; o.onSpawn?.(p) }
  })
  // Set in onLine; TypeScript cannot see that and narrows it to null.
  const kit = started as { ok: boolean; version: string | null } | null
  if (kit && !kit.ok) throw new KitMissingError(kit.version)
  const tail = () => output.trim().split(/\r?\n/).slice(-5).join(' | ').slice(-1000)
  const { json, usage } = parseStream(output)
  // Reported before the result is judged, so a failed step still updates the usage reading.
  // A failing callback never fails the step.
  if (usage) try { o.onUsage?.(usage) } catch (e) { console.warn('usage callback failed', e) }
  if (code === 0 && json && !json.is_error && typeof json.result === 'string') return { result: json.result, costUsd: json.total_cost_usd ?? 0, json }
  // Errors carry the step's cost when the output reported one, so the run's cap still counts it.
  const withCost = <E extends Error>(e: E): E & { costUsd?: number } =>
    typeof json?.total_cost_usd === 'number' ? Object.assign(e, { costUsd: json.total_cost_usd }) : e
  // With no result line, only the CLI's own (non-JSON) lines are scanned: stream lines carry story prose and tool results.
  const plain = () => output.split(/\r?\n/).filter(l => !l.trim().startsWith('{')).join('\n').slice(-500)
  const limit = parseUsageLimit(typeof json?.result === 'string' ? json.result.slice(0, 500) : plain())
  if (limit) throw withCost(limit)
  // runShell kills the tree on timeout and reports a failure code; elapsed time tells the two apart.
  if (code !== 0 && Date.now() - t0 >= o.timeoutMs) throw withCost(new Error(`Claude step timed out after ${o.timeoutMs} ms: ${tail()}`))
  throw withCost(new Error(`Claude failed (exit ${code}): ${tail()}`))
}
