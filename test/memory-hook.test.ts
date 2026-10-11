import { expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const hook = resolve('resources/hooks/memory.mjs')
const run = (event: string, input: string, env: Record<string, string> = {}) =>
  spawnSync('node', [hook, event], { input, encoding: 'utf8', env: { ...process.env, ...env } })
function setup() {
  const mem = mkdtempSync(join(tmpdir(), 'nb-mh-'))
  const book = mkdtempSync(join(tmpdir(), 'nb-mh-book-'))
  writeFileSync(join(book, 'book.yaml'), 'id: b\n')
  mkdirSync(join(book, '.novelbrain'))
  mkdirSync(join(book, 'drafts'))
  return { mem, book }
}

test('start prints the briefing for a session anywhere inside the book', () => {
  const { mem, book } = setup()
  writeFileSync(join(book, '.novelbrain', 'memory.md'), '# lessons\nCut filter words.\n')
  const r = run('start', JSON.stringify({ cwd: join(book, 'drafts') }), { NB_MEMORY_DIR: mem })
  expect(r.status).toBe(0)
  expect(r.stdout).toContain('Cut filter words.')
})
test('enqueue appends a distill job with the book root', () => {
  const { mem, book } = setup()
  run('enqueue', JSON.stringify({ cwd: book, transcript_path: 'C:/t/x.jsonl' }), { NB_MEMORY_DIR: mem })
  expect(JSON.parse(readFileSync(join(mem, '.queue'), 'utf8'))).toEqual({ kind: 'distill', transcript: 'C:/t/x.jsonl', book: realpathSync.native(book) }) // the hook resolves 8.3 names (CI's RUNNER~1)
})
test('the distiller own sessions, bad input and a missing memory folder are silent no-ops', () => {
  const { mem, book } = setup()
  for (const [ev, input, env] of [
    ['enqueue', JSON.stringify({ cwd: book, transcript_path: 'x' }), { NB_MEMORY_DIR: mem, NB_DISTILLER: '1' }],
    ['enqueue', '{not json', { NB_MEMORY_DIR: mem }],
    ['enqueue', JSON.stringify({ cwd: book, transcript_path: 'x' }), { NB_MEMORY_DIR: join(mem, 'missing') }],
    ['start', JSON.stringify({ cwd: tmpdir() }), { NB_MEMORY_DIR: mem }]
  ] as const) {
    const r = run(ev, input, env)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  }
  expect(() => readFileSync(join(mem, '.queue'))).toThrow()
})
test('memory is always on: a leftover .off from the old switch is ignored', () => {
  const { mem, book } = setup()
  writeFileSync(join(mem, '.off'), '')
  writeFileSync(join(book, '.novelbrain', 'memory.md'), 'Cut filter words.')
  const s = run('start', JSON.stringify({ cwd: book }), { NB_MEMORY_DIR: mem })
  expect(s.status).toBe(0)
  expect(s.stdout).toBe('Novel Brain hooks loaded.\nCut filter words.')
  run('enqueue', JSON.stringify({ cwd: book, transcript_path: 'C:/t/x.jsonl' }), { NB_MEMORY_DIR: mem })
  expect(readFileSync(join(mem, '.queue'), 'utf8')).toContain('x.jsonl')
})
test('start prints the hook line in a book even with no briefing yet', () => {
  const { mem, book } = setup()
  const r = run('start', JSON.stringify({ cwd: book }), { NB_MEMORY_DIR: mem })
  expect(r.stdout.startsWith('Novel Brain hooks loaded.')).toBe(true)
})
