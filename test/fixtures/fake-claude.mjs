import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.NB_TEST_PIDS) writeFileSync(join(process.env.NB_TEST_PIDS, `claude-${process.pid}`), '')
console.log('FAKE CLAUDE READY')
console.log(`ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(none)'}`)
console.log(`NODEFAULTCWD=${process.env.NoDefaultCurrentDirectoryInExePath ?? ''}`)
console.log(`ARGS=${process.argv.slice(2).join(' ')}`)
console.log(`CWD=${process.cwd()}`)
process.stdin.on('data', d => process.stdout.write(`echo:${d}`))
setInterval(() => {}, 1 << 30)
