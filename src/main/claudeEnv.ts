// cmd.exe searches the working directory (the book) before PATH; this stops a planted claude.cmd from running.
export function claudeEnv(base: Record<string, string>, opts: { headroomUrl?: string }): Record<string, string> {
  const env: Record<string, string> = { ...base, NoDefaultCurrentDirectoryInExePath: '1' }
  if (opts.headroomUrl) env.ANTHROPIC_BASE_URL = opts.headroomUrl
  return env
}
