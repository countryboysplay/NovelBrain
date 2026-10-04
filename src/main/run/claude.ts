import { runShell } from '../run'
import { claudeEnv } from '../claudeEnv'

export class UsageLimitError extends Error {
  constructor(readonly resetAt: string | null) {
    super(resetAt ? `Claude usage limit reached. Resets ${resetAt}.` : 'Claude usage limit reached.')
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

export interface ClaudeRun { result: string; costUsd: number; json: unknown }

export async function runClaude(
  prompt: string,
  o: { cwd: string; command: string; model: string; timeoutMs: number; headroomUrl?: string; maxTurns?: number; onSpawn?: (pid: number | undefined) => void }
): Promise<ClaudeRun> {
  if (!/^[A-Za-z0-9._:-]+$/.test(o.model)) throw new Error(`invalid model name: ${JSON.stringify(o.model)}`)
  const args = ['-p', '--output-format json', `--model ${o.model}`, '--permission-mode acceptEdits', `--settings "${o.cwd}/.claude/settings.local.json"`]
  if (o.maxTurns) args.push(`--max-turns ${o.maxTurns}`)
  const t0 = Date.now()
  const { code, output } = await runShell(`"${o.command}" ${args.join(' ')}`, undefined, {
    cwd: o.cwd,
    input: prompt,
    env: claudeEnv(process.env as Record<string, string>, { headroomUrl: o.headroomUrl }),
    timeoutMs: o.timeoutMs,
    onSpawn: o.onSpawn
  })
  const tail = () => output.trim().split(/\r?\n/).slice(-5).join(' | ')
  const line = output.split(/\r?\n/).reverse().find(l => l.trim().startsWith('{'))
  let json: { is_error?: boolean; result?: string; total_cost_usd?: number } | null = null
  try {
    json = line ? JSON.parse(line) : null
  } catch {
    json = null
  }
  if (code === 0 && json && !json.is_error && typeof json.result === 'string') return { result: json.result, costUsd: json.total_cost_usd ?? 0, json }
  // Errors carry the step's cost when the output reported one, so the run's cap still counts it.
  const withCost = <E extends Error>(e: E): E & { costUsd?: number } =>
    typeof json?.total_cost_usd === 'number' ? Object.assign(e, { costUsd: json.total_cost_usd }) : e
  const limit = parseUsageLimit(typeof json?.result === 'string' ? json.result.slice(0, 500) : output.slice(-500))
  if (limit) throw withCost(limit)
  // runShell kills the tree on timeout and reports a failure code; elapsed time tells the two apart.
  if (code !== 0 && Date.now() - t0 >= o.timeoutMs) throw withCost(new Error(`Claude step timed out after ${o.timeoutMs} ms: ${tail()}`))
  throw withCost(new Error(`Claude failed (exit ${code}): ${tail()}`))
}
