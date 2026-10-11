import { expect, test } from 'vitest'
import { deepPrompt, distillPrompt, parseVerdict, recheckPrompt } from '../src/main/memory/prompts'

const indexes = { writer: '- [a](topics/a.md) — x', series: '', book: '' }
test('distill prompt forbids story facts and names the three scopes', () => {
  const p = distillPrompt({ slices: 'USER: hi', indexes, seriesDir: 'series/s', bookDir: 'books/b', day: '2026-10-04' })
  for (const s of ['Never store story facts', 'topics/<name>.md', 'series/s/topics/<name>.md', 'books/b/topics/<name>.md', 'type: preference | catch | voice | craft', 'rules: [', 'verified: 2026-10-04', '(empty)', 'USER: hi'])
    expect(p).toContain(s)
  expect(p).not.toContain('inbox/')
})
test('deep prompt proposes skills to inbox only and lists rejected names', () => {
  const p = deepPrompt({ act: 'ACT-1', reviews: 'FLAG x', indexes, seriesDir: 'series/s', bookDir: 'books/b', skills: ['chase'], rejected: ['montage'], day: '2026-10-04' })
  for (const s of ['ACT-1', 'inbox/<name>/SKILL.md', 'two or more chapters', 'montage', 'chase', 'Never store story facts', 'FLAG x']) expect(p).toContain(s)
})
test('verdict parsing', () => {
  expect(parseVerdict('REWRITE\nnew text')).toEqual({ verdict: 'REWRITE', body: 'new text' })
  expect(parseVerdict('maybe')).toBeNull()
  expect(parseVerdict('KEEP')).toEqual({ verdict: 'KEEP', body: '' })
  expect(parseVerdict('noise\nREWRITE\nNew text.\n')).toEqual({ verdict: 'REWRITE', body: 'New text.\n' })
  expect(parseVerdict('DELETE — obsolete')?.verdict).toBe('DELETE')
})
test('recheck prompt starts with RECHECK and marks deleted files', () => {
  const m = { file: 'x', body: 'lesson', meta: { name: 'a', type: 'craft' as const, summary: 's', sources: [], verified: 'd', used: 'd', uses: 0, stale: true, pinned: false, status: 'live' as const, by: '', rules: [], quiet: 0, hits: 0, live: '' } }
  const p = recheckPrompt(m, [{ file: 'a.md', text: 'text' }, { file: 'b.md', text: null }])
  expect(p.startsWith('RECHECK')).toBe(true)
  expect(p).toContain('<<<a.md>>>\ntext')
  expect(p).toContain('<<<b.md>>>\n(deleted)')
})
